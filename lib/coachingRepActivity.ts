// A rep's own day-by-day activity, for the Coaching application's sales rep dashboard
// (app/api/integrations/coaching/reference?resource=rep-activity&codes=...&from=YYYY-MM-DD&to=YYYY-MM-DD).
//
// The Coaching app lets a rep see their own day, month or year, so this answers for any window rather than the two fixed months of
// resource=performance. Same sources and rules as the rest of this application:
//
//  - Value and volume (cases): the SAP reconciliation (DailySalesRepActual) when the rep has rows in the window. Reps with none,
//    such as the Mars indirect sellers (MBSR, TDR), use their own Pine calls (RepCall.sales and RepCall.cases) instead, and the row
//    says which source it used so the app can say so.
//  - Calls, productive calls, days worked: RepCall (Pine), as everywhere else.
//  - Drop size (volume): cases per productive call, the same definition as Rep Performance (lib/repPerformance.ts).
//  - LPPC (lines per productive call): the number of distinct cost centres (brands) bought in the productive calls, per productive call.
//    Rep Performance counts distinct brands from BrandCustomerActual, which is month grain and only for SAP reps; the call records carry
//    the cost centres bought on every call, so this works for every rep and for any window.
//  - JP adherence: the PJP ownership adherence of lib/jpAdherence.ts for the window: planned outlets, outlets visited, planned and not
//    visited.

/** A SAP sales row as read: its employee code when the sync could match the SAP salesperson name to the roster, otherwise only the SAP name. */
export interface SapRowByName {
  employeeCode: string | null;
  sapName: string;
  date: string;
  cases: number;
  revenue: number;
}

/** The roster names that identify an employee: the Pine name and the SAP name the roster holds. */
export interface RosterNames {
  employeeCode: string;
  pineName: string | null;
  sapName: string | null;
}

/** The same name key Rep Performance uses (lib/repPerformance.ts nameFallbackKey): case, spaces and punctuation ignored. */
export const nameKey = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * SAP sales rows that carry no employee code (the sync leaves a row unmatched when the SAP salesperson name is not the one the roster holds, for example a principal booked
 * under a different spelling) belong to the employee whose roster name matches, exactly as Rep Performance attributes them. A name two employees share is never guessed.
 * Rows are added up per employee code and day.
 */
export function foldSapRowsByName(rows: SapRowByName[], roster: RosterNames[]): RepSapDayFact[] {
  const owners = new Map<string, Set<string>>();
  for (const e of roster) {
    for (const key of [nameKey(e.pineName), nameKey(e.sapName)]) {
      if (!key) continue;
      owners.set(key, (owners.get(key) ?? new Set()).add(e.employeeCode));
    }
  }
  const unique = new Map<string, string>();
  for (const [key, codes] of owners) if (codes.size === 1) unique.set(key, [...codes][0]);

  const folded = new Map<string, RepSapDayFact>();
  for (const row of rows) {
    const code = row.employeeCode ?? unique.get(nameKey(row.sapName)) ?? null;
    if (!code) continue;
    const id = `${code}|${row.date}`;
    const have = folded.get(id);
    if (have) {
      have.cases += row.cases;
      have.revenue += row.revenue;
    } else folded.set(id, { employeeCode: code, date: row.date, cases: row.cases, revenue: row.revenue });
  }
  return [...folded.values()];
}

export interface RepSapDayFact {
  employeeCode: string;
  date: string; // YYYY-MM-DD
  cases: number;
  revenue: number;
}

export interface RepCallDayFact {
  employeeCode: string;
  date: string;
  calls: number;
  productiveCalls: number;
  /** Sales value on the rep's own calls (Pine). */
  sales: number;
  /** Cases from the calls whose products all had a pack size; callsWithQty/callsWithCases say how complete it is. */
  cases: number | null;
  callsWithQty: number;
  callsWithCases: number;
  /** Cost centres bought, summed over the productive calls. */
  lines: number;
}

export interface RepJpFact {
  employeeCode: string;
  outletsPlanned: number;
  outletsVisited: number;
  plannedNotVisited: number;
  jpAdherencePct: number;
}

export interface RepActivityDay {
  date: string;
  /** Sales value for the day (SAP, or the rep's own Pine calls when there is no SAP row). */
  value: number;
  cases: number | null;
  calls: number;
  productiveCalls: number;
  lines: number;
}

export interface RepActivity {
  employeeCode: string;
  /** Where value and cases come from for this rep in this window. */
  source: "sap" | "pine_calls" | null;
  /** Pine-calls source only: the share of selling calls whose cases could be worked out (100 = all). */
  volumeCoveragePct: number | null;
  days: RepActivityDay[];
  totals: {
    value: number;
    cases: number | null;
    calls: number;
    productiveCalls: number;
    daysWorked: number;
    strikeRatePct: number | null;
    /** Cases per productive call. */
    dropSize: number | null;
    /** Lines (cost centres) per productive call. */
    lppc: number | null;
  };
  jp: { outletsPlanned: number; outletsVisited: number; plannedNotVisited: number; adherencePct: number | null } | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function shapeRepActivity(input: {
  codes: string[];
  sap: RepSapDayFact[];
  calls: RepCallDayFact[];
  jp: RepJpFact[];
}): RepActivity[] {
  return input.codes.map((employeeCode) => {
    const sapDays = input.sap.filter((r) => r.employeeCode === employeeCode);
    const callDays = input.calls.filter((r) => r.employeeCode === employeeCode);
    const useSap = sapDays.length > 0;
    const source: RepActivity["source"] = useSap ? "sap" : callDays.some((c) => c.callsWithQty > 0 || c.sales > 0) ? "pine_calls" : null;

    const dates = new Set<string>([...callDays.map((c) => c.date), ...(useSap ? sapDays.map((s) => s.date) : [])]);
    const sapByDate = new Map(sapDays.map((s) => [s.date, s]));
    const callByDate = new Map(callDays.map((c) => [c.date, c]));

    const days: RepActivityDay[] = [...dates].sort().map((date) => {
      const call = callByDate.get(date);
      const sap = sapByDate.get(date);
      return {
        date,
        value: round2(useSap ? (sap?.revenue ?? 0) : (call?.sales ?? 0)),
        cases: useSap ? (sap ? round1(sap.cases) : 0) : (call?.cases != null ? round1(call.cases) : null),
        calls: call?.calls ?? 0,
        productiveCalls: call?.productiveCalls ?? 0,
        lines: call?.lines ?? 0,
      };
    });

    const calls = days.reduce((n, d) => n + d.calls, 0);
    const productive = days.reduce((n, d) => n + d.productiveCalls, 0);
    const lines = days.reduce((n, d) => n + d.lines, 0);
    const value = days.reduce((n, d) => n + d.value, 0);
    const casesKnown = days.some((d) => d.cases !== null);
    const cases = casesKnown ? round1(days.reduce((n, d) => n + (d.cases ?? 0), 0)) : null;

    const withQty = callDays.reduce((n, c) => n + c.callsWithQty, 0);
    const withCases = callDays.reduce((n, c) => n + c.callsWithCases, 0);
    const jpFact = input.jp.find((j) => j.employeeCode === employeeCode);

    return {
      employeeCode,
      source,
      volumeCoveragePct: source === "pine_calls" && withQty > 0 ? round1((withCases / withQty) * 100) : null,
      days,
      totals: {
        value: round2(value),
        cases,
        calls,
        productiveCalls: productive,
        daysWorked: callDays.filter((c) => c.calls > 0).length,
        strikeRatePct: calls > 0 ? round1((productive / calls) * 100) : null,
        dropSize: cases !== null && productive > 0 ? round1(cases / productive) : null,
        lppc: productive > 0 && lines > 0 ? round1(lines / productive) : null,
      },
      jp: jpFact
        ? {
            outletsPlanned: jpFact.outletsPlanned,
            outletsVisited: jpFact.outletsVisited,
            plannedNotVisited: jpFact.plannedNotVisited,
            adherencePct: jpFact.outletsPlanned > 0 ? round1(jpFact.jpAdherencePct) : null,
          }
        : null,
    };
  });
}
