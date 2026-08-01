import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";

export type SalesRoleFilter = "all" | "Primary Sales" | "Secondary Sales";

export interface JpAdherenceFilters {
  /** Normalized (lib/normalize.ts's normalizePrincipalKey), or null for "All Principals". */
  principalKey: string | null;
  date: Date | null;
  /** Day names ("Monday".."Sunday"); null/empty = no restriction. */
  dayNames: string[] | null;
  roleFilter: SalesRoleFilter;
  employeeCode: string | null;
}

export interface JpAdherenceKpis {
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  unplannedVisits: number;
}

export interface JpRepDaySummaryRow {
  date: string;
  employeeCode: string;
  employeeName: string;
  salesRole: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  status: "Excellent" | "Good" | "Below Target";
}

export interface JpMonthlyCoverageRow {
  year: string;
  monthIndex: number;
  employeeCode: string;
  employeeName: string;
  principal: string;
  principalKey: string;
  salesRole: string;
  activityStatus: "Active" | "Inactive";
  coverage: number;
  productive: number;
  productivityPct: number;
  revenue: number;
  qty: number;
}

export interface JpPlanRow {
  date: string;
  day: string;
  employeeCode: string;
  employeeName: string;
  customerId: string;
  customerName: string;
  region: string;
  teamLeader: string;
  routeName: string;
  subRegion: string;
  salesRole: string;
  channel: string;
}

export interface JpDetailRow {
  employeeCode: string;
  employeeName: string;
  customerId: string;
  customerName: string;
  plannedFlag: boolean;
  visitedFlag: boolean;
  productiveFlag: boolean;
  jpStatus: "Planned & Productive" | "Planned & Visited" | "Planned Not Visited" | "Unplanned Visit";
  sales: number;
  qty: number;
}

export interface JpAdherenceSummary {
  kpis: JpAdherenceKpis;
  repDaySummary: JpRepDaySummaryRow[];
  planRows: JpPlanRow[];
  availableMonths: string[];
  availableDates: string[];
  availableReps: { employeeCode: string; employeeName: string }[];
}

const EMPTY_SQL = Prisma.sql``;
const PLAN_ROW_LIMIT = 500;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function statusFor(jpAdherencePct: number): "Excellent" | "Good" | "Below Target" {
  if (jpAdherencePct >= 90) return "Excellent";
  if (jpAdherencePct >= 75) return "Good";
  return "Below Target";
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** JS equivalent of repCallDayNameExpr()'s SQL CASE — used where a day name is
 *  needed outside a query (e.g. tests, or future non-SQL callers). Both must
 *  stay in lockstep: Date.getUTCDay() and Postgres's EXTRACT(DOW...) share the
 *  same 0=Sunday..6=Saturday convention. */
export function dayNameFromDate(date: Date): string {
  return DAY_NAMES[date.getUTCDay()];
}

/** "YYYY-MM" -> that month's [start, end) window, in UTC. */
export function monthWindow(year: string, monthIndex: number): { start: Date; end: Date } {
  return { start: new Date(Date.UTC(Number(year), monthIndex, 1)), end: new Date(Date.UTC(Number(year), monthIndex + 1, 1)) };
}

/** Reps whose EmployeePrincipalContribution membership matches the selected principal —
 *  JP Adherence's principal scoping has always been contribution-based (a rep may have
 *  one absolute Timestamp principal but be relevant to several JPA principals), unlike
 *  Timestamps' single-absolute-principal model. Known limitation: the uploaded Journey
 *  Plan workbook has no Principal column, so a multi-principal rep's planned-outlet
 *  count is identical under each of their contributed principals — there is no way to
 *  attribute a specific planned visit to one principal over another from the source file. */
async function principalEligibleEmployeeCodes(principalKey: string): Promise<string[]> {
  const rows = await prisma.employeeMaster.findMany({
    where: { active: true },
    select: { employeeCode: true, contributions: { select: { principal: true } } },
  });
  return rows.filter((r) => r.contributions.some((c) => normalizePrincipalKey(c.principal) === principalKey)).map((r) => r.employeeCode);
}

/** ANDs together every employeeCode-based restriction (TeamLeaderScope, principal
 *  contribution membership, rep search) into one list, or "ALL" when unrestricted.
 *  Role filtering is NOT included here — both JourneyPlanRow and RepCall already carry
 *  their own salesRole column directly (no EmployeeMaster join needed for that one). */
async function resolveEmployeeCodeFilter(scope: TeamLeaderScope | null, principalKey: string | null, employeeCode: string | null): Promise<string[] | "ALL"> {
  let codes: string[] | null = null;
  if (scope) codes = scope.employeeCodes;
  if (principalKey) {
    const eligible = await principalEligibleEmployeeCodes(principalKey);
    codes = codes ? codes.filter((c) => eligible.includes(c)) : eligible;
  }
  if (employeeCode) codes = codes ? codes.filter((c) => c === employeeCode) : [employeeCode];
  return codes ?? "ALL";
}

function employeeCodeClause(column: Prisma.Sql, codes: string[] | "ALL"): Prisma.Sql {
  if (codes === "ALL") return EMPTY_SQL;
  if (codes.length === 0) return Prisma.sql`AND false`;
  return Prisma.sql`AND ${column} IN (${Prisma.join(codes)})`;
}

function dayNameClause(column: Prisma.Sql, dayNames: string[] | null): Prisma.Sql {
  if (!dayNames || dayNames.length === 0) return EMPTY_SQL;
  return Prisma.sql`AND ${column} = ANY(${dayNames})`;
}

/** Postgres's to_char(date,'Day') is locale-dependent; a fixed CASE over
 *  EXTRACT(DOW...) always matches the workbook's own English day names. */
function repCallDayNameExpr(): Prisma.Sql {
  return Prisma.sql`
    CASE EXTRACT(DOW FROM r.date)::int
      WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday'
      WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' ELSE 'Saturday'
    END
  `;
}

interface PlanJoinRow {
  date: Date;
  employeeCode: string;
  employeeName: string;
  salesRole: string;
  customerId: string;
  outletsPlanned: bigint | number;
  outletsVisited: bigint | number;
  productiveOutlets: bigint | number;
}

/** Core plan-anchored aggregate: JourneyPlanRow LEFT JOIN RepCall, grouped per rep-day.
 *  Covers everything except Unplanned Visits (which by definition has no plan row to
 *  anchor on — see getUnplannedVisits). */
async function getRepDayRows(range: { start: Date; end: Date }, scope: TeamLeaderScope | null, filters: JpAdherenceFilters): Promise<JpRepDaySummaryRow[]> {
  const codes = await resolveEmployeeCodeFilter(scope, filters.principalKey, filters.employeeCode);
  const roleClause = filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND p."salesRole" = ${filters.roleFilter}`;
  const dateClause = filters.date ? Prisma.sql`AND p.date >= ${filters.date} AND p.date < ${new Date(filters.date.getTime() + 86400000)}` : EMPTY_SQL;

  const rows = await prisma.$queryRaw<PlanJoinRow[]>(Prisma.sql`
    SELECT
      p.date AS date,
      p."employeeCode" AS "employeeCode",
      MAX(p."employeeName") AS "employeeName",
      MAX(p."salesRole") AS "salesRole",
      COUNT(DISTINCT p."customerId")::int AS "outletsPlanned",
      COUNT(DISTINCT p."customerId") FILTER (WHERE r.id IS NOT NULL)::int AS "outletsVisited",
      COUNT(DISTINCT p."customerId") FILTER (WHERE r."callOutcome" = 'Sale')::int AS "productiveOutlets"
    FROM "JourneyPlanRow" p
    LEFT JOIN "RepCall" r ON r.date = p.date AND r."employeeCode" = p."employeeCode" AND r."outletId" = p."customerId"
    WHERE p.date >= ${range.start} AND p.date < ${range.end}
    ${employeeCodeClause(Prisma.sql`p."employeeCode"`, codes)}
    ${dayNameClause(Prisma.sql`p.day`, filters.dayNames)}
    ${roleClause}
    ${dateClause}
    GROUP BY p.date, p."employeeCode"
  `);

  return rows.map((r) => {
    const outletsPlanned = Number(r.outletsPlanned);
    const outletsVisited = Number(r.outletsVisited);
    const productiveOutlets = Number(r.productiveOutlets);
    const jpAdherencePct = outletsPlanned > 0 ? round1((outletsVisited / outletsPlanned) * 100) : 0;
    const strikeRatePct = outletsVisited > 0 ? round1((productiveOutlets / outletsVisited) * 100) : 0;
    return {
      date: r.date.toISOString().slice(0, 10),
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      salesRole: r.salesRole,
      outletsPlanned,
      outletsVisited,
      jpAdherencePct,
      productiveOutlets,
      strikeRatePct,
      plannedNotVisited: outletsPlanned - outletsVisited,
      status: statusFor(jpAdherencePct),
    };
  });
}

/** RepCall rows with no matching plan row for that rep-day-outlet — a visit that
 *  wasn't on the plan at all. */
async function getUnplannedVisits(range: { start: Date; end: Date }, scope: TeamLeaderScope | null, filters: JpAdherenceFilters): Promise<number> {
  const codes = await resolveEmployeeCodeFilter(scope, filters.principalKey, filters.employeeCode);
  const roleClause = filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND r."salesRole" = ${filters.roleFilter}`;
  const dateClause = filters.date ? Prisma.sql`AND r.date >= ${filters.date} AND r.date < ${new Date(filters.date.getTime() + 86400000)}` : EMPTY_SQL;

  const result = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(DISTINCT (r.date, r."employeeCode", r."outletId"))::bigint AS count
    FROM "RepCall" r
    LEFT JOIN "JourneyPlanRow" p ON p.date = r.date AND p."employeeCode" = r."employeeCode" AND p."customerId" = r."outletId"
    WHERE p.id IS NULL AND r.date >= ${range.start} AND r.date < ${range.end}
    ${employeeCodeClause(Prisma.sql`r."employeeCode"`, codes)}
    ${dayNameClause(repCallDayNameExpr(), filters.dayNames)}
    ${roleClause}
    ${dateClause}
  `);
  return Number(result[0]?.count ?? 0);
}

function aggregateKpis(repDaySummary: JpRepDaySummaryRow[], unplannedVisits: number): JpAdherenceKpis {
  const outletsPlanned = repDaySummary.reduce((s, r) => s + r.outletsPlanned, 0);
  const outletsVisited = repDaySummary.reduce((s, r) => s + r.outletsVisited, 0);
  const productiveOutlets = repDaySummary.reduce((s, r) => s + r.productiveOutlets, 0);
  return {
    outletsPlanned,
    outletsVisited,
    jpAdherencePct: outletsPlanned > 0 ? round1((outletsVisited / outletsPlanned) * 100) : 0,
    productiveOutlets,
    strikeRatePct: outletsVisited > 0 ? round1((productiveOutlets / outletsVisited) * 100) : 0,
    plannedNotVisited: outletsPlanned - outletsVisited,
    unplannedVisits,
  };
}

async function getPlanRows(range: { start: Date; end: Date }, scope: TeamLeaderScope | null, filters: JpAdherenceFilters): Promise<JpPlanRow[]> {
  const codes = await resolveEmployeeCodeFilter(scope, filters.principalKey, filters.employeeCode);
  const where: Prisma.Sql[] = [Prisma.sql`p.date >= ${range.start} AND p.date < ${range.end}`];
  if (codes !== "ALL") {
    if (codes.length === 0) where.push(Prisma.sql`false`);
    else where.push(Prisma.sql`p."employeeCode" IN (${Prisma.join(codes)})`);
  }
  if (filters.dayNames && filters.dayNames.length > 0) where.push(Prisma.sql`p.day = ANY(${filters.dayNames})`);
  if (filters.roleFilter !== "all") where.push(Prisma.sql`p."salesRole" = ${filters.roleFilter}`);
  if (filters.date) where.push(Prisma.sql`p.date >= ${filters.date} AND p.date < ${new Date(filters.date.getTime() + 86400000)}`);

  const rows = await prisma.$queryRaw<
    { date: Date; day: string; employeeCode: string; employeeName: string; customerId: string; customerName: string; region: string; teamLeader: string; routeName: string; subRegion: string; salesRole: string; channel: string }[]
  >(Prisma.sql`
    SELECT p.date, p.day, p."employeeCode", p."employeeName", p."customerId", p."customerName", p.region, p."teamLeader", p."routeName", p."subRegion", p."salesRole", p.channel
    FROM "JourneyPlanRow" p
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY p.date, p."employeeCode", p."customerName"
    LIMIT ${PLAN_ROW_LIMIT}
  `);
  return rows.map((r) => ({ ...r, date: r.date.toISOString().slice(0, 10) }));
}

export async function getJpAdherenceSummary(range: { start: Date; end: Date }, scope: TeamLeaderScope | null, filters: JpAdherenceFilters): Promise<JpAdherenceSummary> {
  const [repDaySummary, unplannedVisits, planRows] = await Promise.all([
    getRepDayRows(range, scope, filters),
    getUnplannedVisits(range, scope, filters),
    getPlanRows(range, scope, filters),
  ]);

  const availableDates = Array.from(new Set(repDaySummary.map((r) => r.date))).sort();
  const availableReps = Array.from(new Map(repDaySummary.map((r) => [r.employeeCode, { employeeCode: r.employeeCode, employeeName: r.employeeName }])).values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );

  return {
    kpis: aggregateKpis(repDaySummary, unplannedVisits),
    repDaySummary: repDaySummary.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName)),
    planRows,
    availableMonths: [],
    availableDates,
    availableReps,
  };
}

/** The months JourneyPlanRow actually has data for — drives the Month selector without
 *  needing a separate round trip for every filter change. */
export async function getAvailablePlanMonths(scope: TeamLeaderScope | null): Promise<string[]> {
  const codes = scope ? scope.employeeCodes : null;
  const rows = await prisma.$queryRaw<{ monthLabel: string }[]>(Prisma.sql`
    SELECT DISTINCT "monthLabel" FROM "JourneyPlanRow"
    ${codes ? (codes.length > 0 ? Prisma.sql`WHERE "employeeCode" IN (${Prisma.join(codes)})` : Prisma.sql`WHERE false`) : EMPTY_SQL}
    ORDER BY "monthLabel"
  `);
  return rows.map((r) => r.monthLabel);
}

/** Rep-day drill-down (replaces the old JPAdherenceDetail lazy fetch) — small enough
 *  (one rep, one day) to just fetch both sides and classify in JS. */
export async function getJpAdherenceDetail(date: Date, employeeCode: string): Promise<JpDetailRow[]> {
  const dayEnd = new Date(date.getTime() + 86400000);
  const [planRows, callRows] = await Promise.all([
    prisma.journeyPlanRow.findMany({ where: { date, employeeCode }, select: { customerId: true, customerName: true, employeeName: true } }),
    prisma.repCall.findMany({ where: { date: { gte: date, lt: dayEnd }, employeeCode }, select: { outletId: true, outletName: true, callOutcome: true, sales: true, qty: true, salesRep: true } }),
  ]);

  const callByOutlet = new Map(callRows.map((c) => [c.outletId, c]));
  const rows: JpDetailRow[] = [];
  const employeeName = planRows[0]?.employeeName ?? callRows[0]?.salesRep ?? "";

  for (const p of planRows) {
    const call = callByOutlet.get(p.customerId);
    const visitedFlag = !!call;
    const productiveFlag = call?.callOutcome === "Sale";
    rows.push({
      employeeCode,
      employeeName,
      customerId: p.customerId,
      customerName: p.customerName,
      plannedFlag: true,
      visitedFlag,
      productiveFlag,
      jpStatus: productiveFlag ? "Planned & Productive" : visitedFlag ? "Planned & Visited" : "Planned Not Visited",
      sales: call?.sales ?? 0,
      qty: call?.qty ?? 0,
    });
  }

  const plannedOutletIds = new Set(planRows.map((p) => p.customerId));
  for (const c of callRows) {
    if (plannedOutletIds.has(c.outletId)) continue;
    rows.push({
      employeeCode,
      employeeName,
      customerId: c.outletId,
      customerName: c.outletName,
      plannedFlag: false,
      visitedFlag: true,
      productiveFlag: c.callOutcome === "Sale",
      jpStatus: "Unplanned Visit",
      sales: c.sales,
      qty: c.qty,
    });
  }

  return rows;
}

interface CoverageRawRow {
  employeeCode: string;
  year: string;
  monthIndex: number;
  coverage: bigint | number;
  productive: bigint | number;
  revenue: number;
  qty: number;
}

/** Coverage/Productivity/Activity-Status by rep/month, sourced from RepCall alone
 *  (replaces JPMonthlySplitRow's old Pine-fetch-based rollup) — reused both by the JP
 *  Adherence page's own summary table and by lib/datasetStore.ts's overlayCoverage.
 *  A rep's whole book of RepCall activity is attributed to their absolute principal,
 *  matching the convention already established for RepCall-sourced data elsewhere in
 *  this app (Timestamps, Rep Performance) — not resolved per-transaction. Naturally
 *  bounded to RepCall's own 3-trailing-month retention; there is no year parameter,
 *  since there's nothing to query outside that window. Active if the rep has any
 *  Sale-outcome call anywhere in the retained window, else Inactive. */
export async function getMonthlyCoverageRollup(scope: TeamLeaderScope | null): Promise<JpMonthlyCoverageRow[]> {
  const scopeClause = scope
    ? scope.employeeCodes.length > 0
      ? Prisma.sql`AND "employeeCode" IN (${Prisma.join(scope.employeeCodes)})`
      : Prisma.sql`AND false`
    : EMPTY_SQL;

  const [raw, masters] = await Promise.all([
    prisma.$queryRaw<CoverageRawRow[]>(Prisma.sql`
      SELECT
        "employeeCode",
        EXTRACT(YEAR FROM date)::text AS year,
        (EXTRACT(MONTH FROM date)::int - 1) AS "monthIndex",
        COUNT(DISTINCT "outletId")::int AS coverage,
        COUNT(DISTINCT "outletId") FILTER (WHERE "callOutcome" = 'Sale')::int AS productive,
        COALESCE(SUM(sales), 0)::double precision AS revenue,
        COALESCE(SUM(qty), 0)::double precision AS qty
      FROM "RepCall"
      WHERE true ${scopeClause}
      GROUP BY "employeeCode", year, "monthIndex"
    `),
    prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, absolutePrincipal: true, salesRole: true, active: true } }),
  ]);

  const masterByCode = new Map(masters.map((m) => [m.employeeCode, m]));
  const anyActive = new Set(raw.filter((r) => Number(r.productive) > 0).map((r) => r.employeeCode));

  return raw.map((r) => {
    const master = masterByCode.get(r.employeeCode);
    const coverage = Number(r.coverage);
    const productive = Number(r.productive);
    return {
      year: r.year,
      monthIndex: r.monthIndex,
      employeeCode: r.employeeCode,
      employeeName: master?.pineName ?? r.employeeCode,
      principal: master?.absolutePrincipal ?? "Unassigned",
      principalKey: master ? normalizePrincipalKey(master.absolutePrincipal) : "unassigned",
      salesRole: master?.salesRole ?? "Unassigned",
      activityStatus: anyActive.has(r.employeeCode) ? "Active" : "Inactive",
      coverage,
      productive,
      productivityPct: coverage > 0 ? round1((productive / coverage) * 100) : 0,
      revenue: r.revenue,
      qty: r.qty,
    } as JpMonthlyCoverageRow;
  });
}
