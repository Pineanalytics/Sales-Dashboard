// Reads the call analysis's rep-day facts from the four systems' own tables. Each system's rules are the ones its Coverage &
// Productivity and Time in Trade figures already use:
//   - Pine (RepCall): a call is one rep at one outlet on one day; productive when there was a sale or order. A rep's principal is the
//     Employee Roaster's, falling back to the cost centre they mostly sell where they have no roster row; a chosen principal takes
//     the same reps as the Timestamps report (own principal, or their Team Leader covers it).
//   - EABL DMS (EablCall): one row per call, with the DMS's own productive flag. No product lines or cases.
//   - Upfield DataEdge (UpfieldTransaction): only transactions, so an outlet is called when it has any row that day and productive
//     when it has a sale above zero. Product lines are the different items sold.
//   - Unilever Leverage: times from the PJP/DSR daily activity, sales from the invoice lines (types 01 and 06). It never records a
//     call without a sale, so it has no calls or strike rate.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { principalEmployeeCodes, scopeClause, unmappedPrincipalsCte } from "@/lib/timestampSummary";
import { restrictToPrincipal, scopeNameClause, UPFIELD_PRINCIPAL, type TeamLeaderScope } from "@/lib/teamLeaderScope";
import { nairobiMinutesAfterMidnight } from "@/lib/timeManagement";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { CALL_SOURCES, NO_TEAM_LEADER, type CallSource, type RepDayFact } from "./types";

export interface FactQuery {
  /** First day, UTC midnight. */
  start: Date;
  /** The day after the last, UTC midnight. */
  end: Date;
  /** Principals selected (any spelling); empty = all. */
  principals: string[];
  sources: readonly CallSource[];
  scope: TeamLeaderScope | null;
}

const nameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const brand = (principal: string) => principal.split("-")[0].trim();
const minutes = (value: Date | null): number | null => (value ? nairobiMinutesAfterMidnight(value.toISOString()) : null);

/** Team Leader by rep name, for the systems that record only a name. A name two Team Leaders claim is left unassigned. */
export function teamLeaderByName(rows: { names: (string | null)[]; teamLeader: string | null }[]): Map<string, string> {
  const found = new Map<string, Set<string>>();
  for (const row of rows) {
    const teamLeader = row.teamLeader?.trim();
    if (!teamLeader) continue;
    for (const name of row.names) {
      if (!name?.trim()) continue;
      const key = nameKey(name);
      found.set(key, (found.get(key) ?? new Set()).add(teamLeader));
    }
  }
  return new Map([...found].filter(([, leaders]) => leaders.size === 1).map(([name, leaders]) => [name, [...leaders][0]]));
}

async function loadTeamLeaderNames(): Promise<Map<string, string>> {
  const [employees, assignments, leaders] = await Promise.all([
    prisma.employeeMaster.findMany({ where: { active: true }, select: { pineName: true, sapName: true, teamLeader: true } }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeName: true, sapName: true, teamLeaderId: true } }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
  ]);
  const leaderName = new Map(leaders.map((leader) => [leader.id, leader.name]));
  const rostered = teamLeaderByName(employees.map((e) => ({ names: [e.pineName, e.sapName], teamLeader: e.teamLeader })));
  const assigned = teamLeaderByName(assignments.map((a) => ({ names: [a.employeeName, a.sapName], teamLeader: leaderName.get(a.teamLeaderId) ?? null })));
  return new Map([...assigned, ...rostered]);
}

interface PineRow {
  date: string;
  employeeCode: string;
  salesRep: string;
  role: string;
  teamLeader: string | null;
  principal: string | null;
  firstCall: Date | null;
  lastCall: Date | null;
  calls: number;
  productive: number;
  outlets: string[] | null;
  productiveOutlets: string[] | null;
  value: number | null;
  lines: number | null;
  linesCalls: number;
  cases: number | null;
  casesCalls: number;
  intervalSum: number | null;
  intervalCount: number;
}

async function pineFacts({ start, end, principals, scope }: FactQuery): Promise<RepDayFact[]> {
  const range = { start, end };
  // A chosen principal: which reps it takes, and the name their rows go under.
  const selected = new Map<string, string>(); // employeeCode -> selected principal
  for (const principal of principals) {
    for (const code of await principalEmployeeCodes(principal, range, scope)) if (!selected.has(code)) selected.set(code, principal);
  }
  if (principals.length > 0 && selected.size === 0) return [];
  const codeClause = principals.length > 0 ? Prisma.sql`AND r."employeeCode" IN (${Prisma.join([...selected.keys()])})` : Prisma.empty;

  const rows = await prisma.$queryRaw<PineRow[]>(Prisma.sql`
    WITH ${unmappedPrincipalsCte(range, scope)}
    SELECT
      to_char(r.date, 'YYYY-MM-DD') AS date,
      r."employeeCode" AS "employeeCode",
      MAX(r."salesRep") AS "salesRep",
      MAX(COALESCE(NULLIF(BTRIM(em."salesRole"), ''), r."salesRole")) AS role,
      MAX(NULLIF(BTRIM(em."teamLeader"), '')) AS "teamLeader",
      MAX(COALESCE(NULLIF(BTRIM(em."absolutePrincipal"), ''), inferred.principal)) AS principal,
      MIN(r."firstCallOfDay") AS "firstCall",
      MAX(r."lastCallOfDay") AS "lastCall",
      COUNT(*)::int AS calls,
      COUNT(*) FILTER (WHERE r."callOutcome" = 'Sale')::int AS productive,
      array_agg(r."outletId") AS outlets,
      array_agg(r."outletId") FILTER (WHERE r."callOutcome" = 'Sale') AS "productiveOutlets",
      SUM(r.sales) FILTER (WHERE r."callOutcome" = 'Sale')::double precision AS value,
      SUM(r.lines) FILTER (WHERE r."callOutcome" = 'Sale')::int AS lines,
      COUNT(r.lines) FILTER (WHERE r."callOutcome" = 'Sale')::int AS "linesCalls",
      SUM(r.cases) FILTER (WHERE r."callOutcome" = 'Sale')::double precision AS cases,
      COUNT(r.cases) FILTER (WHERE r."callOutcome" = 'Sale')::int AS "casesCalls",
      SUM(r."intervalMins")::double precision AS "intervalSum",
      COUNT(r."intervalMins")::int AS "intervalCount"
    FROM "RepCall" r
    LEFT JOIN "EmployeeMaster" em ON em."employeeCode" = r."employeeCode"
    LEFT JOIN inferred ON em.id IS NULL AND inferred."employeeCode" = r."employeeCode"
    WHERE r.date >= ${start} AND r.date < ${end} AND COALESCE(em.active, true) ${codeClause} ${scopeClause(scope)}
    GROUP BY r.date, r."employeeCode"
  `);

  const selectedKeys = new Map(principals.map((p) => [normalizePrincipalKey(p), p]));
  return rows.map((r) => {
    const own = r.principal?.trim() || "Unmapped";
    // With principals chosen, a rep goes under their own where it is one of them, otherwise under the one that brought them in.
    const shown = principals.length === 0 ? own : (selectedKeys.get(normalizePrincipalKey(own)) ?? selected.get(r.employeeCode) ?? own);
    return {
      source: "pine",
      date: r.date,
      repKey: `pine:${r.employeeCode}`,
      repName: r.salesRep,
      principalKey: normalizePrincipalKey(shown),
      principal: brand(shown),
      teamLeader: r.teamLeader ?? NO_TEAM_LEADER,
      role: r.role,
      firstMinutes: minutes(r.firstCall),
      lastMinutes: minutes(r.lastCall),
      calls: r.calls,
      productive: r.productive,
      outlets: r.outlets ?? [],
      productiveOutlets: r.productiveOutlets ?? [],
      lines: r.lines ?? 0,
      linesCalls: r.linesCalls,
      value: r.value ?? 0,
      cases: r.cases ?? 0,
      casesCalls: r.casesCalls,
      intervalSum: r.intervalSum ?? 0,
      intervalCount: r.intervalCount,
    };
  });
}

/** What the three single-principal systems share. */
function namedFact(source: CallSource, principal: string, rep: { id: string; name: string }, teamLeaders: Map<string, string>) {
  return {
    source,
    repKey: `${source}:${rep.id}`,
    repName: rep.name,
    principalKey: normalizePrincipalKey(principal),
    principal,
    teamLeader: teamLeaders.get(nameKey(rep.name)) ?? NO_TEAM_LEADER,
    role: "Primary Sales",
    cases: 0,
    casesCalls: 0,
    intervalSum: 0,
    intervalCount: 0,
  };
}

async function eablFacts({ start, end, scope }: FactQuery, teamLeaders: Map<string, string>): Promise<RepDayFact[]> {
  const own = restrictToPrincipal(scope, /^eabl/i);
  const rows = await prisma.$queryRaw<
    { date: string; salesman: string; firstCall: Date | null; lastCall: Date | null; calls: number; productive: number; outlets: string[]; productiveOutlets: string[] | null; value: number | null }[]
  >(Prisma.sql`
    SELECT date, salesman, MIN(first_call) AS "firstCall", MAX(last_call) AS "lastCall",
      COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE productive)::int AS productive,
      array_agg(outlet) AS outlets, array_agg(outlet) FILTER (WHERE productive) AS "productiveOutlets",
      SUM(value) FILTER (WHERE productive)::double precision AS value
    FROM (
      SELECT to_char("callDate", 'YYYY-MM-DD') AS date, salesman,
        COALESCE(NULLIF(BTRIM("customerCode"), ''), "customerName") AS outlet,
        MIN("firstCallOfDay") AS first_call, MAX("lastCallOfDay") AS last_call,
        BOOL_OR("isProductive") AS productive, SUM("netSales") AS value
      FROM "EablCall"
      WHERE "callDate" >= ${start} AND "callDate" < ${end} ${scopeNameClause(own, Prisma.sql`salesman`)}
      GROUP BY 1, 2, 3
    ) outlet_day
    GROUP BY date, salesman
  `);
  return rows.map((r) => ({
    ...namedFact("eabl", "EABL", { id: r.salesman, name: r.salesman }, teamLeaders),
    date: r.date,
    firstMinutes: minutes(r.firstCall),
    lastMinutes: minutes(r.lastCall),
    calls: r.calls,
    productive: r.productive,
    outlets: r.outlets,
    productiveOutlets: r.productiveOutlets ?? [],
    lines: 0,
    linesCalls: 0,
    value: r.value ?? 0,
  }));
}

// DataEdge's txnDate is a true UTC instant; the others are Nairobi wall-clock already.
const NAIROBI_OFFSET = Prisma.sql`INTERVAL '3 hours'`;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const UPFIELD_REP = Prisma.sql`REGEXP_REPLACE(BTRIM(fsr), '\\s+', ' ', 'g')`;

async function upfieldFacts({ start, end, scope }: FactQuery, teamLeaders: Map<string, string>): Promise<RepDayFact[]> {
  const own = restrictToPrincipal(scope, UPFIELD_PRINCIPAL);
  const rows = await prisma.$queryRaw<
    { date: string; rep: string; firstCall: Date; lastCall: Date; calls: number; productive: number; outlets: string[]; productiveOutlets: string[] | null; lines: number | null; value: number | null }[]
  >(Prisma.sql`
    SELECT date, rep, MIN(first_at) AS "firstCall", MAX(last_at) AS "lastCall",
      COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE lines > 0)::int AS productive,
      array_agg(outlet) AS outlets, array_agg(outlet) FILTER (WHERE lines > 0) AS "productiveOutlets",
      SUM(lines)::int AS lines, SUM(value)::double precision AS value
    FROM (
      SELECT to_char("txnDate" + ${NAIROBI_OFFSET}, 'YYYY-MM-DD') AS date, ${UPFIELD_REP} AS rep,
        COALESCE(NULLIF(BTRIM("custCode"), ''), NULLIF(BTRIM("custName"), ''), 'unknown') AS outlet,
        MIN("txnDate" + ${NAIROBI_OFFSET}) AS first_at, MAX("txnDate" + ${NAIROBI_OFFSET}) AS last_at,
        COUNT(DISTINCT "itemCode") FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0)::int AS lines,
        COALESCE(SUM("saleIncl") FILTER (WHERE type = 'sale' AND COALESCE("saleIncl", 0) > 0), 0) AS value
      FROM "UpfieldTransaction"
      WHERE "txnDate" >= ${new Date(start.getTime() - NAIROBI_OFFSET_MS)} AND "txnDate" < ${new Date(end.getTime() - NAIROBI_OFFSET_MS)}
        AND NULLIF(BTRIM(fsr), '') IS NOT NULL AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST' ${scopeNameClause(own, UPFIELD_REP)}
      GROUP BY 1, 2, 3
    ) outlet_day
    GROUP BY date, rep
  `);
  return rows.map((r) => ({
    ...namedFact("upfield", "Upfield", { id: r.rep, name: r.rep }, teamLeaders),
    date: r.date,
    firstMinutes: minutes(r.firstCall),
    lastMinutes: minutes(r.lastCall),
    calls: r.calls,
    productive: r.productive,
    outlets: r.outlets,
    productiveOutlets: r.productiveOutlets ?? [],
    lines: r.lines ?? 0,
    linesCalls: r.productive,
    value: r.value ?? 0,
  }));
}

export interface LeverageTimeRow {
  date: string;
  distributor: string;
  dsr: string;
  dsrName: string;
  firstEntry: Date | null;
  lastEntry: Date | null;
}

export interface LeverageSalesRow {
  date: string;
  distributor: string;
  dsr: string;
  dsrName: string;
  productive: number;
  outlets: string[];
  lines: number;
  value: number;
  cases: number | null;
  casesCalls: number;
}

/** One fact per branch, rep and delivery day from the two Leverage feeds: either one alone still counts the day. */
export function mergeLeverage(times: LeverageTimeRow[], sales: LeverageSalesRow[], teamLeaders: Map<string, string>): RepDayFact[] {
  const key = (r: { date: string; distributor: string; dsr: string }) => `${r.date}|${r.distributor}|${r.dsr}`;
  const timeByKey = new Map(times.map((r) => [key(r), r]));
  const salesByKey = new Map(sales.map((r) => [key(r), r]));
  return [...new Set([...timeByKey.keys(), ...salesByKey.keys()])].map((k) => {
    const time = timeByKey.get(k);
    const sale = salesByKey.get(k);
    const base = (time ?? sale)!;
    const name = (time?.dsrName ?? sale!.dsrName).replace(new RegExp(`_${base.distributor}$`), "").trim();
    const branch = SALES_RETURNS_BRANCH_LABELS[base.distributor] ?? base.distributor;
    const fact = namedFact("unilever", "Unilever", { id: `${base.distributor}:${base.dsr}`, name }, teamLeaders);
    return {
      ...fact,
      repName: `${name} (${branch})`,
      date: base.date,
      firstMinutes: minutes(time?.firstEntry ?? null),
      lastMinutes: minutes(time?.lastEntry ?? time?.firstEntry ?? null),
      calls: null,
      productive: sale?.productive ?? 0,
      outlets: sale?.outlets ?? [],
      productiveOutlets: sale?.outlets ?? [],
      lines: sale?.lines ?? 0,
      linesCalls: sale?.productive ?? 0,
      value: sale?.value ?? 0,
      cases: sale?.cases ?? 0,
      casesCalls: sale?.casesCalls ?? 0,
    };
  });
}

async function leverageFacts({ start, end, scope }: FactQuery, teamLeaders: Map<string, string>): Promise<RepDayFact[]> {
  const own = restrictToPrincipal(scope, /^unilever/i);
  const [times, sales] = await Promise.all([
    prisma.$queryRaw<LeverageTimeRow[]>(Prisma.sql`
      SELECT to_char(date, 'YYYY-MM-DD') AS date, distributor, dsr, MAX("dsrName") AS "dsrName",
        MIN("firstEntryTime") AS "firstEntry", MAX(COALESCE("lastEntryTime", "firstEntryTime")) AS "lastEntry"
      FROM "PjpDsrDailyActivity"
      WHERE date >= ${start} AND date < ${end} ${scopeNameClause(own, Prisma.sql`"dsrName"`)}
      GROUP BY 1, 2, 3
    `),
    // The invoice feed writes the rep as NAME_branch; the roster knows the plain name.
    prisma.$queryRaw<LeverageSalesRow[]>(Prisma.sql`
      SELECT date, distributor, dsr, MAX(name) AS "dsrName",
        COUNT(*)::int AS productive, array_agg(outlet) AS outlets, SUM(lines)::int AS lines,
        SUM(value)::double precision AS value,
        SUM(cases) FILTER (WHERE cases_known)::double precision AS cases,
        COUNT(*) FILTER (WHERE cases_known)::int AS "casesCalls"
      FROM (
        SELECT to_char("deliveryDate", 'YYYY-MM-DD') AS date, "storageLocation" AS distributor, "salesRepCode" AS dsr,
          MAX(REGEXP_REPLACE("salesRepName", '_[0-9]+$', '')) AS name, "customerCode" AS outlet,
          COUNT(DISTINCT sku)::int AS lines, SUM("netSale") AS value,
          SUM("saleQtyPieces" / NULLIF("piecesPerCase", 0)) AS cases,
          BOOL_AND(COALESCE("piecesPerCase", 0) > 0) AS cases_known
        FROM "SalesReturnLine"
        WHERE "deliveryDate" >= ${start} AND "deliveryDate" < ${end} AND "documentType" IN ('01', '06') AND "saleQtyPieces" > 0
          ${scopeNameClause(own, Prisma.sql`REGEXP_REPLACE("salesRepName", '_[0-9]+$', '')`)}
        GROUP BY 1, 2, 3, "customerCode"
      ) outlet_day
      GROUP BY date, distributor, dsr
    `),
  ]);
  return mergeLeverage(times, sales, teamLeaders);
}

const NAMED_SOURCES = { eabl: eablFacts, upfield: upfieldFacts, unilever: leverageFacts } as const;

export async function loadRepDayFacts(query: FactQuery): Promise<RepDayFact[]> {
  const keys = new Set(query.principals.map((p) => normalizePrincipalKey(p)));
  const named = (Object.keys(NAMED_SOURCES) as (keyof typeof NAMED_SOURCES)[]).filter(
    // Each of these systems is one principal, named after it.
    (source) => query.sources.includes(source) && (keys.size === 0 || keys.has(source))
  );
  const teamLeaders = named.length > 0 ? await loadTeamLeaderNames() : new Map<string, string>();
  const parts = await Promise.all([
    query.sources.includes("pine") ? pineFacts(query) : Promise.resolve<RepDayFact[]>([]),
    ...named.map((source) => NAMED_SOURCES[source](query, teamLeaders)),
  ]);
  return parts.flat();
}

/** The first and last day each system holds, so the page can say what a date range can and cannot show. */
export async function loadAvailability(): Promise<{ source: CallSource; first: string | null; last: string | null }[]> {
  const rows = await prisma.$queryRaw<{ source: CallSource; first: string | null; last: string | null }[]>(Prisma.sql`
    SELECT 'pine' AS source, to_char(MIN(date), 'YYYY-MM-DD') AS first, to_char(MAX(date), 'YYYY-MM-DD') AS last FROM "RepCall"
    UNION ALL SELECT 'eabl', to_char(MIN("callDate"), 'YYYY-MM-DD'), to_char(MAX("callDate"), 'YYYY-MM-DD') FROM "EablCall"
    UNION ALL SELECT 'upfield', to_char(MIN("txnDate" + ${NAIROBI_OFFSET}), 'YYYY-MM-DD'), to_char(MAX("txnDate" + ${NAIROBI_OFFSET}), 'YYYY-MM-DD') FROM "UpfieldTransaction"
    UNION ALL SELECT 'unilever', to_char(MIN("deliveryDate"), 'YYYY-MM-DD'), to_char(MAX("deliveryDate"), 'YYYY-MM-DD') FROM "SalesReturnLine"
  `);
  return CALL_SOURCES.map((source) => rows.find((r) => r.source === source) ?? { source, first: null, last: null });
}
