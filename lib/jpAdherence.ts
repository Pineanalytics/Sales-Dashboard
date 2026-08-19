import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
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
  /** Employee Roaster's EmployeeMaster.teamLeader free-text value. */
  teamLeader: string | null;
}

export interface JpAdherenceKpis {
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
}

export interface JpRepDaySummaryRow {
  date: string;
  employeeCode: string;
  employeeName: string;
  /** The rep's own EmployeeMaster.salesRole (Employee Roster's fixed
   *  classification) — deliberately NOT RepCall.salesRole, a per-call tag
   *  that can disagree with a rep's own roster role (confirmed live: 26 of
   *  121 active reps in a recent month had at least one call tagged the
   *  opposite role from their own EmployeeMaster.salesRole). Filtering by
   *  the per-call tag let the wrong reps leak into a role-filtered view;
   *  filtering by the rep's own fixed role makes inclusion unambiguous. */
  salesRole: string;
  teamLeader: string;
  principal: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  status: "Excellent" | "Good" | "Below Target";
}

/** Productivity-target JP Adherence — the simplest of the definitions this
 *  page has carried (after JourneyPlanRow's ~4% unusable exact-day match,
 *  and an intra-month historical-pattern version before that; see git
 *  history for both). Per direct request: every outlet a rep actually
 *  visited in the period IS "the plan" (plannedOutlets = total distinct
 *  outlets called); "visited" for adherence purposes means productive
 *  (Sale-outcome) — so JP Adherence % = productive ÷ total visited. Status
 *  is a flat pass/fail against a fixed 75% productivity target, not a
 *  three-tier scale — Strike is met or it isn't. Deliberately distinct from
 *  JpRepDaySummaryRow/JpAdherenceKpis above (this page's original "PJP
 *  Ownership Adherence"), which measures ownership alignment against
 *  ActiveOutlet's static pjpEmployeeCode assignment — kept as its own
 *  section since it answers a different question. */
export const STRIKE_TARGET_PCT = 75;

export interface JpPatternAdherenceKpis {
  plannedOutlets: number;
  visitedOutlets: number;
  planAdherencePct: number;
  repsAboveTarget: number;
  repsBelowTarget: number;
}

export interface JpPatternRepRow {
  employeeCode: string;
  employeeName: string;
  teamLeader: string;
  principal: string;
  salesRole: string;
  plannedOutlets: number;
  visitedOutlets: number;
  planAdherencePct: number;
  missedOutlets: number;
  status: "Met Target" | "Below Target";
}

export interface JpPatternAdherenceSummary {
  kpis: JpPatternAdherenceKpis;
  repRows: JpPatternRepRow[];
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

export interface JpDetailRow {
  employeeCode: string;
  employeeName: string;
  customerId: string;
  customerName: string;
  plannedFlag: boolean;
  visitedFlag: boolean;
  productiveFlag: boolean;
  jpStatus: "PJP-aligned & Productive" | "PJP-aligned Visit" | "Outside PJP";
  sales: number;
  qty: number;
}

export interface JpAdherenceSummary {
  kpis: JpAdherenceKpis;
  repDaySummary: JpRepDaySummaryRow[];
  availableMonths: string[];
  availableDates: string[];
  availableReps: { employeeCode: string; employeeName: string }[];
  availableTeamLeaders: string[];
}

const EMPTY_SQL = Prisma.sql``;

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
async function teamLeaderEligibleEmployeeCodes(teamLeader: string): Promise<string[]> {
  const rows = await prisma.employeeMaster.findMany({ where: { teamLeader }, select: { employeeCode: true } });
  return rows.map((r) => r.employeeCode);
}

/** Reps whose absolute principal or contribution membership matches the selected
 *  principal — same "contribution is authoritative for principal membership" rule
 *  already used by loadViewerPrincipalScope (lib/teamLeaderScope.ts). Without this,
 *  a principal-filtered view still pulled every rep company-wide into the
 *  outletsPlanned denominator (only the PJP-owned-outlets CTE was actually
 *  principal-scoped), diluting jpAdherencePct toward 0% for any principal whose
 *  own call volume is small relative to the whole company's — confirmed live:
 *  Suntory's true scoped adherence was 15.29%, showing as 2.09% (and rounding to
 *  0.0% under a narrower date filter) before this fix. */
async function principalEligibleEmployeeCodes(principalKey: string): Promise<string[]> {
  const employees = await prisma.employeeMaster.findMany({
    where: { active: true },
    select: { employeeCode: true, absolutePrincipal: true, contributions: { select: { principal: true } } },
  });
  return employees
    .filter(
      (e) =>
        normalizePrincipalKey(e.absolutePrincipal) === principalKey ||
        e.contributions.some((c) => normalizePrincipalKey(c.principal) === principalKey)
    )
    .map((e) => e.employeeCode);
}

/** ANDs together every employeeCode-based restriction (TeamLeaderScope, principal
 *  contribution membership, Employee Roaster team leader, rep search) into one list,
 *  or "ALL" when unrestricted. Role filtering is NOT included here — both
 *  JourneyPlanRow and RepCall already carry their own salesRole column directly (no
 *  EmployeeMaster join needed for that one). */
async function resolveEmployeeCodeFilter(
  scope: TeamLeaderScope | null,
  principalKey: string | null,
  employeeCode: string | null,
  teamLeader: string | null
): Promise<string[] | "ALL"> {
  let codes: string[] | null = null;
  if (scope) codes = scope.employeeCodes;
  if (principalKey) {
    const eligible = await principalEligibleEmployeeCodes(principalKey);
    codes = codes ? codes.filter((c) => eligible.includes(c)) : eligible;
  }
  if (teamLeader) {
    const eligible = await teamLeaderEligibleEmployeeCodes(teamLeader);
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
  salesRole: string | null;
  teamLeader: string | null;
  principal: string | null;
  timestampVisits: bigint | number;
  pjpAlignedVisits: bigint | number;
  productivePjpVisits: bigint | number;
}

/** Core plan-anchored aggregate: JourneyPlanRow LEFT JOIN RepCall, grouped per rep-day.
 *  Covers everything except Unplanned Visits (which by definition has no plan row to
 *  anchor on — see getUnplannedVisits). */
async function getRepDayRows(range: { start: Date; end: Date }, scope: TeamLeaderScope | null, filters: JpAdherenceFilters): Promise<JpRepDaySummaryRow[]> {
  // JpAdherenceFilters.principalKey's own doc comment says "normalized" but
  // every principal selector in this app (principalsByRevenueDesc /
  // summarizeSalesByPrincipal, deliberately keyed by the RAW principal
  // string so same-brand different-location principals like
  // "EABL-Nyeri"/"EABL-Nyahururu" list separately) actually sends the raw
  // display name, e.g. "Suntory-Nairobi" — never pre-normalized. Every other
  // working principal-filtered feature normalizes at the point of use
  // (lib/timestampSummary.ts's timestampPrincipalKey) rather than trusting
  // the caller; this file never did, so both the PJP-owned-outlets match
  // below and the rep-eligibility filter always compared a normalized
  // left-hand side against an un-normalized filters.principalKey and never
  // matched anything — confirmed live: filtering by "Suntory-Nairobi"
  // produced zero PJP-aligned visits, not just diluted ones.
  const principalKey = filters.principalKey ? normalizePrincipalKey(filters.principalKey) : null;
  const codes = await resolveEmployeeCodeFilter(scope, principalKey, filters.employeeCode, filters.teamLeader);
  // Filters by the rep's own EmployeeMaster.salesRole (Employee Roster's
  // fixed classification), not RepCall.salesRole (a per-call tag) — see
  // JpRepDaySummaryRow.salesRole's own comment for why: a rep's per-call tag
  // can disagree with their roster role, so filtering on it let the wrong
  // reps leak into a role-filtered view even though every individual row's
  // own tag matched. This also means every call for an included rep counts
  // (not just the ones happening to carry the matching tag), which is the
  // correct reading of "show me this rep's activity" once inclusion is
  // decided by the rep, not the call.
  const roleClause = filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND e."salesRole" = ${filters.roleFilter}`;
  const dateClause = filters.date ? Prisma.sql`AND r.date >= ${filters.date} AND r.date < ${new Date(filters.date.getTime() + 86400000)}` : EMPTY_SQL;
  const years = Array.from(
    new Set([range.start.getUTCFullYear(), new Date(range.end.getTime() - 1).getUTCFullYear()].map(String))
  );
  const principalClause = principalKey
    ? Prisma.sql`AND regexp_replace(split_part(lower(a.principal), '-', 1), '[^a-z0-9]', '', 'g') = ${principalKey}`
    : EMPTY_SQL;

  const rows = await prisma.$queryRaw<PlanJoinRow[]>(Prisma.sql`
    WITH pjp_owned_outlets AS (
      SELECT DISTINCT a."customerId", a."pjpEmployeeCode"
      FROM "ActiveOutlet" a
      WHERE a.status = 'Active'
        AND a."pjpEmployeeCode" IS NOT NULL
        AND a."pjpEmployeeCode" <> ''
        AND a.year IN (${Prisma.join(years)})
        ${principalClause}
    )
    SELECT
      r.date AS date,
      r."employeeCode" AS "employeeCode",
      MAX(r."salesRep") AS "employeeName",
      MAX(e."salesRole") AS "salesRole",
      MAX(e."teamLeader") AS "teamLeader",
      MAX(e."absolutePrincipal") AS "principal",
      COUNT(DISTINCT r."outletId")::int AS "timestampVisits",
      COUNT(DISTINCT r."outletId") FILTER (WHERE p."customerId" IS NOT NULL)::int AS "pjpAlignedVisits",
      COUNT(DISTINCT r."outletId") FILTER (WHERE p."customerId" IS NOT NULL AND r."callOutcome" = 'Sale')::int AS "productivePjpVisits"
    FROM "RepCall" r
    LEFT JOIN "EmployeeMaster" e ON e."employeeCode" = r."employeeCode"
    LEFT JOIN pjp_owned_outlets p
      ON p."customerId" = r."outletId" AND p."pjpEmployeeCode" = r."employeeCode"
    WHERE r.date >= ${range.start} AND r.date < ${range.end}
    ${employeeCodeClause(Prisma.sql`r."employeeCode"`, codes)}
    ${dayNameClause(repCallDayNameExpr(), filters.dayNames)}
    ${roleClause}
    ${dateClause}
    GROUP BY r.date, r."employeeCode"
  `);

  return rows.map((r) => {
    const outletsPlanned = Number(r.timestampVisits);
    const outletsVisited = Number(r.pjpAlignedVisits);
    const productiveOutlets = Number(r.productivePjpVisits);
    const jpAdherencePct = outletsPlanned > 0 ? round1((outletsVisited / outletsPlanned) * 100) : 0;
    const strikeRatePct = outletsVisited > 0 ? round1((productiveOutlets / outletsVisited) * 100) : 0;
    return {
      date: r.date.toISOString().slice(0, 10),
      employeeCode: r.employeeCode,
      employeeName: r.employeeName,
      salesRole: r.salesRole ?? "Unassigned",
      teamLeader: r.teamLeader ?? "Unassigned",
      principal: r.principal ?? "Unassigned",
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
function aggregateKpis(repDaySummary: JpRepDaySummaryRow[]): JpAdherenceKpis {
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
  };
}

interface PatternRawRow {
  employeeCode: string;
  employeeName: string;
  teamLeader: string | null;
  principal: string | null;
  salesRole: string | null;
  plannedOutlets: bigint | number; // total distinct outlets visited — "the plan"
  visitedOutlets: bigint | number; // of those, the productive (Sale-outcome) ones
}

/** Productivity-target JP Adherence — see JpPatternAdherenceSummary's own
 *  comment for the definition and why this replaced two earlier versions.
 *  Single query, one row per rep, same employeeCode/role scoping as every
 *  other report on this page. */
export async function getPatternAdherenceSummary(
  range: { start: Date; end: Date },
  scope: TeamLeaderScope | null,
  filters: JpAdherenceFilters
): Promise<JpPatternAdherenceSummary> {
  const principalKey = filters.principalKey ? normalizePrincipalKey(filters.principalKey) : null;
  const codes = await resolveEmployeeCodeFilter(scope, principalKey, filters.employeeCode, filters.teamLeader);
  const roleClause = filters.roleFilter === "all" ? EMPTY_SQL : Prisma.sql`AND e."salesRole" = ${filters.roleFilter}`;
  const dateClause = filters.date
    ? Prisma.sql`AND r.date >= ${filters.date} AND r.date < ${new Date(filters.date.getTime() + 86400000)}`
    : EMPTY_SQL;

  const rows = await prisma.$queryRaw<PatternRawRow[]>(Prisma.sql`
    SELECT
      r."employeeCode" AS "employeeCode",
      MAX(COALESCE(e."pineName", r."salesRep")) AS "employeeName",
      MAX(e."teamLeader") AS "teamLeader",
      MAX(e."absolutePrincipal") AS "principal",
      MAX(e."salesRole") AS "salesRole",
      COUNT(DISTINCT r."outletId")::int AS "plannedOutlets",
      COUNT(DISTINCT r."outletId") FILTER (WHERE r."callOutcome" = 'Sale')::int AS "visitedOutlets"
    FROM "RepCall" r
    LEFT JOIN "EmployeeMaster" e ON e."employeeCode" = r."employeeCode"
    WHERE r.date >= ${range.start} AND r.date < ${range.end}
    ${employeeCodeClause(Prisma.sql`r."employeeCode"`, codes)}
    ${dayNameClause(repCallDayNameExpr(), filters.dayNames)}
    ${roleClause}
    ${dateClause}
    GROUP BY r."employeeCode"
  `);

  const repRows: JpPatternRepRow[] = rows
    .map((r) => {
      const plannedOutlets = Number(r.plannedOutlets);
      const visitedOutlets = Number(r.visitedOutlets);
      const planAdherencePct = plannedOutlets > 0 ? round1((visitedOutlets / plannedOutlets) * 100) : 0;
      return {
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        teamLeader: r.teamLeader ?? "Unassigned",
        principal: r.principal ?? "Unassigned",
        salesRole: r.salesRole ?? "Unassigned",
        plannedOutlets,
        visitedOutlets,
        planAdherencePct,
        missedOutlets: plannedOutlets - visitedOutlets,
        status: (planAdherencePct >= STRIKE_TARGET_PCT ? "Met Target" : "Below Target") as "Met Target" | "Below Target",
      };
    })
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));

  const plannedOutlets = repRows.reduce((s, r) => s + r.plannedOutlets, 0);
  const visitedOutlets = repRows.reduce((s, r) => s + r.visitedOutlets, 0);

  return {
    kpis: {
      plannedOutlets,
      visitedOutlets,
      planAdherencePct: plannedOutlets > 0 ? round1((visitedOutlets / plannedOutlets) * 100) : 0,
      repsAboveTarget: repRows.filter((r) => r.status === "Met Target").length,
      repsBelowTarget: repRows.filter((r) => r.status === "Below Target").length,
    },
    repRows,
  };
}

/** Distinct Employee Roaster team leader names within the caller's own
 *  TeamLeaderScope (or all, for admin/unscoped) — independent of the current
 *  month/date/role/rep selection, matching how availableReps/availableMonths
 *  are also computed as a stable filter-option list, not a narrowing result. */
async function getAvailableTeamLeaders(scope: TeamLeaderScope | null): Promise<string[]> {
  const rows = await prisma.employeeMaster.findMany({
    where: { active: true, teamLeader: { not: null }, ...(scope ? { employeeCode: { in: scope.employeeCodes } } : {}) },
    select: { teamLeader: true },
    distinct: ["teamLeader"],
  });
  return rows.map((r) => r.teamLeader!).sort();
}

export async function getJpAdherenceSummary(range: { start: Date; end: Date }, scope: TeamLeaderScope | null, filters: JpAdherenceFilters): Promise<JpAdherenceSummary> {
  const [repDaySummary, availableTeamLeaders] = await Promise.all([
    getRepDayRows(range, scope, filters),
    getAvailableTeamLeaders(scope),
  ]);
  const availableDates = Array.from(new Set(repDaySummary.map((r) => r.date))).sort();
  const availableReps = Array.from(new Map(repDaySummary.map((r) => [r.employeeCode, { employeeCode: r.employeeCode, employeeName: r.employeeName }])).values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName)
  );

  return {
    kpis: aggregateKpis(repDaySummary),
    repDaySummary: repDaySummary.sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName)),
    availableMonths: [],
    availableDates,
    availableReps,
    availableTeamLeaders,
  };
}

// Same reasoning as lib/timestampSummary.ts's getTimestampSummaryCached: only
// scope.employeeCodes crosses the cache boundary (the only field this file
// ever reads off scope — checked directly above), never the full
// TeamLeaderScope, since its Set-typed normalizedNames field doesn't survive
// unstable_cache's argument serialization safely. range's two Dates and
// every JpAdherenceFilters field are plain-JSON-safe as-is.
const getJpAdherenceSummaryCachedInner = unstable_cache(
  async (range: { start: Date; end: Date }, employeeCodes: string[] | null, filters: JpAdherenceFilters): Promise<JpAdherenceSummary> => {
    const scope: TeamLeaderScope | null = employeeCodes
      ? { teamLeaderId: null, supervisorId: null, teamLeaderIds: [], principals: [], employeeCodes, normalizedNames: new Set() }
      : null;
    return getJpAdherenceSummary(range, scope, filters);
  },
  ["jp-adherence-summary"],
  // range is already a discrete, stable value here (a fixed month window or
  // explicit from/to params — never a continuously-advancing "now"), so a
  // short TTL is enough to collapse concurrent identical requests without
  // needing any rounding at the call site, unlike Timestamps.
  { revalidate: 60 }
);

export async function getJpAdherenceSummaryCached(
  range: { start: Date; end: Date },
  scope: TeamLeaderScope | null,
  filters: JpAdherenceFilters
): Promise<JpAdherenceSummary> {
  return getJpAdherenceSummaryCachedInner(range, scope ? scope.employeeCodes : null, filters);
}

/** Timestamp months available to the caller, for the Month selector. */
export async function getAvailablePlanMonths(scope: TeamLeaderScope | null): Promise<string[]> {
  const codes = scope ? scope.employeeCodes : null;
  const rows = await prisma.$queryRaw<{ monthLabel: string }[]>(Prisma.sql`
    SELECT DISTINCT to_char(date, 'YYYY-MM') AS "monthLabel" FROM "RepCall"
    ${codes ? (codes.length > 0 ? Prisma.sql`WHERE "employeeCode" IN (${Prisma.join(codes)})` : Prisma.sql`WHERE false`) : EMPTY_SQL}
    ORDER BY "monthLabel" DESC
  `);
  return rows.map((r) => r.monthLabel);
}

/** Rep-day drill-down (replaces the old JPAdherenceDetail lazy fetch) — small enough
 *  (one rep, one day) to just fetch both sides and classify in JS. */
export async function getJpAdherenceDetail(date: Date, employeeCode: string): Promise<JpDetailRow[]> {
  const dayEnd = new Date(date.getTime() + 86400000);
  const callRows = await prisma.repCall.findMany({
    where: { date: { gte: date, lt: dayEnd }, employeeCode },
    select: { outletId: true, outletName: true, callOutcome: true, sales: true, qty: true, salesRep: true },
  });
  if (callRows.length === 0) return [];

  const pjpOutlets = await prisma.activeOutlet.findMany({
    where: {
      year: String(date.getUTCFullYear()),
      status: "Active",
      pjpEmployeeCode: employeeCode,
      customerId: { in: [...new Set(callRows.map((call) => call.outletId))] },
    },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const pjpOutletIds = new Set(pjpOutlets.map((outlet) => outlet.customerId));
  const employeeName = callRows[0]?.salesRep ?? "";

  return callRows.map((call) => {
    const pjpAligned = pjpOutletIds.has(call.outletId);
    const productiveFlag = call.callOutcome === "Sale";
    return {
      employeeCode,
      employeeName,
      customerId: call.outletId,
      customerName: call.outletName,
      plannedFlag: pjpAligned,
      visitedFlag: true,
      productiveFlag,
      jpStatus: pjpAligned ? (productiveFlag ? "PJP-aligned & Productive" : "PJP-aligned Visit") : "Outside PJP",
      sales: call.sales,
      qty: call.qty,
    };
  });
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

interface EablCoverageRawRow {
  salesman: string;
  principal: string;
  year: string;
  monthIndex: number;
  coverage: bigint | number;
  productive: bigint | number;
  revenue: number;
}

/** EABL's equivalent of getMonthlyCoverageRollup above — same shape, so
 *  overlayCoverage can merge both sources into dataset.monthlyCoverage with
 *  no changes on that side. Sourced from EablCall (already live in this
 *  Postgres DB, no new connection needed) joined to EablCustomerMaster on
 *  customerCode for principal attribution — calls with no customerCode
 *  match are excluded rather than guessed into a principal, same "don't
 *  guess" rule used throughout this bridge. That join only resolves for
 *  calls synced since customerCode was added to the EABL bridge query
 *  (see EablCall.customerCode's own doc comment) — coverage here is
 *  therefore non-retroactive and grows from that point forward, the same
 *  "going forward, not reconstructed" principle already established for
 *  Pine's own RepCall-sourced rollup above (see that function's comment).
 *  No EABL "sales rep roster" exists to resolve a real salesRole from
 *  (confirmed live - no equivalent of EmployeeMaster for EABL's DSR reps),
 *  so every row is tagged "Primary Sales": EABL's DSR call reps are the
 *  sole/direct sales channel for these on-trade outlets, not a support
 *  role - the same single-role assumption already used for Pine's own DSR/
 *  MBSR/TDR reps in the common case. Revisit if EABL ever needs a
 *  Secondary-Sales distinction of its own.
 *
 *  Attribution: EABL's DSR model lets several reps/agents call the same
 *  outlet within one month (confirmed live — summing each rep's own
 *  distinct-outlet count against the true distinct-across-reps count showed
 *  ~2x inflation for both Nyeri and Nyahururu), unlike Pine's PJP model
 *  where an outlet has exactly one owning rep. lib/timeIntelligence.ts's
 *  monthlyCoverageTotals sums coverage across reps within a principal/month
 *  to get the period total — a valid shortcut only when each outlet is
 *  counted once. So each outlet-month here is attributed to a single
 *  primary rep (most calls that month; ties broken by who actually sold,
 *  then by name for determinism) before counting, keeping coverage additive
 *  across reps the same way Pine's already is, instead of double-counting
 *  outlets several reps called. "Productive" (sold-to) stays a property of
 *  the outlet-month itself — true if ANY rep's call there that month was a
 *  sale, regardless of who ends up credited with the coverage. */
export async function getEablMonthlyCoverageRollup(): Promise<JpMonthlyCoverageRow[]> {
  const raw = await prisma.$queryRaw<EablCoverageRawRow[]>(Prisma.sql`
    WITH outlet_month AS (
      SELECT
        ec."customerCode",
        ecm.principal,
        EXTRACT(YEAR FROM ec."callDate")::text AS year,
        (EXTRACT(MONTH FROM ec."callDate")::int - 1) AS "monthIndex",
        BOOL_OR(ec."isProductive") AS "everProductive",
        COALESCE(SUM(ec."netSales"), 0)::double precision AS revenue
      FROM "EablCall" ec
      INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
      WHERE ec."customerCode" IS NOT NULL
      GROUP BY ec."customerCode", ecm.principal, year, "monthIndex"
    ),
    per_rep_calls AS (
      SELECT
        ec."customerCode", ecm.principal,
        EXTRACT(YEAR FROM ec."callDate")::text AS year,
        (EXTRACT(MONTH FROM ec."callDate")::int - 1) AS "monthIndex",
        ec.salesman,
        COUNT(*) AS calls,
        BOOL_OR(ec."isProductive") AS "ownProductive"
      FROM "EablCall" ec
      INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
      WHERE ec."customerCode" IS NOT NULL
      GROUP BY ec."customerCode", ecm.principal, year, "monthIndex", ec.salesman
    ),
    primary_rep AS (
      SELECT DISTINCT ON ("customerCode", principal, year, "monthIndex")
        "customerCode", principal, year, "monthIndex", salesman
      FROM per_rep_calls
      ORDER BY "customerCode", principal, year, "monthIndex", calls DESC, "ownProductive" DESC, salesman ASC
    )
    SELECT
      pr.salesman AS salesman,
      om.principal AS principal,
      om.year AS year,
      om."monthIndex" AS "monthIndex",
      COUNT(*)::int AS coverage,
      COUNT(*) FILTER (WHERE om."everProductive")::int AS productive,
      COALESCE(SUM(om.revenue), 0)::double precision AS revenue
    FROM outlet_month om
    INNER JOIN primary_rep pr USING ("customerCode", principal, year, "monthIndex")
    GROUP BY pr.salesman, om.principal, om.year, om."monthIndex"
  `);

  return raw.map((r) => {
    const coverage = Number(r.coverage);
    const productive = Number(r.productive);
    return {
      year: r.year,
      monthIndex: r.monthIndex,
      employeeCode: r.salesman,
      employeeName: r.salesman,
      principal: r.principal,
      principalKey: normalizePrincipalKey(r.principal),
      salesRole: "Primary Sales",
      activityStatus: productive > 0 ? "Active" : "Inactive",
      coverage,
      productive,
      productivityPct: coverage > 0 ? round1((productive / coverage) * 100) : 0,
      revenue: r.revenue,
      qty: 0,
    } as JpMonthlyCoverageRow;
  });
}
