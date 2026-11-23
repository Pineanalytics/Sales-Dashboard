// The EABL DMS timestamp data feed (/api/feeds/eabl-timestamps): every EABL DMS call as synced into EablCall (one row per customer visit, with
// check-in/check-out), plus two figures worked out per salesman-day (the call's number in the day and the gap since the previous call's
// check-out). Pure apart from loadEablTimestampRows, so the period, the row building and the CSV are testable without a database.
import { prisma } from "@/lib/db";
import { EABL_TIMESTAMP_COLUMNS, EABL_TIMESTAMP_PERIODS } from "@/lib/dataFeedScript";
import { csvCell } from "@/lib/outletUniverse/frequencyExport";

export interface EablTimestampPeriod {
  value: string;
  /** First call date included (UTC midnight, matching EablCall.callDate). */
  start: Date;
  /** First call date NOT included. */
  endExclusive: Date;
  label: string;
}

const DAY_MS = 86_400_000;
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

/** The call dates a period covers, counted in Nairobi time (UTC+3), so "today" is the dashboard's today, not UTC's. Unknown periods fall back to the default. */
export function resolveEablTimestampPeriod(value: string | null | undefined, now: Date = new Date()): EablTimestampPeriod {
  const nairobi = new Date(now.getTime() + 3 * 3_600_000);
  const today = new Date(Date.UTC(nairobi.getUTCFullYear(), nairobi.getUTCMonth(), nairobi.getUTCDate()));
  const endExclusive = new Date(today.getTime() + DAY_MS);
  const known = EABL_TIMESTAMP_PERIODS.find((period) => period.value === value)?.value ?? EABL_TIMESTAMP_PERIODS[0].value;
  const start =
    known === "month" ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    : known === "ytd" ? new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
    : new Date(today.getTime() - (known === "last90" ? 89 : 29) * DAY_MS);
  const label = EABL_TIMESTAMP_PERIODS.find((period) => period.value === known)!.label;
  return { value: known, start, endExclusive, label: `${label} (${fmtDay(start)} to ${fmtDay(today)})` };
}

export interface EablCallRow {
  callDate: Date;
  salesman: string;
  agent: string | null;
  customerCode: string | null;
  customerName: string;
  customerType: string | null;
  segment: string | null;
  /** Time of day only: SQL time values are stored on 1970-01-01. */
  timeIn: Date | null;
  timeOut: Date | null;
  durationMinutes: number | null;
  firstCallOfDay: Date | null;
  lastCallOfDay: Date | null;
  callsInDay: number;
  productiveCallsInDay: number;
  dayStrikeRatePct: number | null;
  cashSales: number;
  creditSales: number;
  discounts: number;
  netSales: number;
  isProductive: boolean;
}

type Cell = string | number;

const clock = (d: Date | null) => (d ? d.toISOString().slice(11, 19) : "");
const num = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : Number(v.toFixed(2)));
const text = (v: string | null | undefined) => v ?? "";

/** The rows as served: one object per call, in date, salesman, check-in order, with the day-level figures worked out from the salesman's own calls
 *  in the rows given. Call No counts the day's calls that have a check-in; the gap is minutes from the previous call's check-out to this check-in
 *  (negative when the calls overlapped; blank for a day's first call or when a time is missing). */
export function eablTimestampRows(calls: EablCallRow[]): Record<string, Cell>[] {
  const sorted = [...calls].sort((a, b) => {
    const byDate = a.callDate.getTime() - b.callDate.getTime();
    if (byDate !== 0) return byDate;
    if (a.salesman !== b.salesman) return a.salesman < b.salesman ? -1 : 1;
    return (a.timeIn?.getTime() ?? Infinity) - (b.timeIn?.getTime() ?? Infinity);
  });
  const rows: Record<string, Cell>[] = [];
  let dayKey = "";
  let callNo = 0;
  let previousOut: Date | null = null;
  for (const call of sorted) {
    const key = `${fmtDay(call.callDate)}|${call.salesman}`;
    if (key !== dayKey) {
      dayKey = key;
      callNo = 0;
      previousOut = null;
    }
    let number: Cell = "";
    let gap: Cell = "";
    if (call.timeIn) {
      callNo += 1;
      number = callNo;
      if (previousOut) gap = Number(((call.timeIn.getTime() - previousOut.getTime()) / 60_000).toFixed(1));
      if (call.timeOut) previousOut = call.timeOut;
    }
    rows.push({
      "Call Date": fmtDay(call.callDate),
      Salesman: call.salesman,
      Agent: text(call.agent),
      "Customer Code": text(call.customerCode),
      Customer: call.customerName,
      "Customer Type": text(call.customerType),
      Segment: text(call.segment),
      "Call No": number,
      "Time In": clock(call.timeIn),
      "Time Out": clock(call.timeOut),
      "Duration (Min)": num(call.durationMinutes),
      "Gap From Previous Call (Min)": gap,
      "First Call Of Day": clock(call.firstCallOfDay),
      "Last Call Of Day": clock(call.lastCallOfDay),
      "Calls In Day": call.callsInDay,
      "Productive Calls In Day": call.productiveCallsInDay,
      "Day Strike Rate %": num(call.dayStrikeRatePct),
      Productive: call.isProductive ? "Y" : "N",
      "Cash Sales": num(call.cashSales),
      "Credit Sales": num(call.creditSales),
      Discounts: num(call.discounts),
      "Net Sales": num(call.netSales),
    });
  }
  return rows;
}

/** The feed as CSV: the asked columns (EABL_TIMESTAMP_COLUMNS names, in the order given; unknown names are skipped), one row per call. */
export function eablTimestampCsv(rows: Record<string, Cell>[], columns: string[]): string {
  const chosen = columns.filter((column) => EABL_TIMESTAMP_COLUMNS.includes(column));
  const lines = [chosen.map(csvCell).join(",")];
  for (const row of rows) lines.push(chosen.map((column) => csvCell(row[column] ?? "")).join(","));
  return lines.join("\r\n");
}

export async function loadEablTimestampRows(period: EablTimestampPeriod): Promise<{ rows: Record<string, Cell>[]; syncedAt: Date | null }> {
  const [calls, latest] = await Promise.all([
    prisma.eablCall.findMany({
      where: { callDate: { gte: period.start, lt: period.endExclusive } },
      select: {
        callDate: true,
        salesman: true,
        agent: true,
        customerCode: true,
        customerName: true,
        customerType: true,
        segment: true,
        timeIn: true,
        timeOut: true,
        durationMinutes: true,
        firstCallOfDay: true,
        lastCallOfDay: true,
        callsInDay: true,
        productiveCallsInDay: true,
        dayStrikeRatePct: true,
        cashSales: true,
        creditSales: true,
        discounts: true,
        netSales: true,
        isProductive: true,
      },
    }),
    prisma.eablCall.aggregate({ _max: { createdAt: true } }),
  ]);
  return { rows: eablTimestampRows(calls), syncedAt: latest._max.createdAt };
}
