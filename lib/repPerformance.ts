import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";

export interface RepPerformanceEmployee {
  employeeCode: string;
  pineName: string;
  sapName: string;
  teamLeader: string | null;
  salesRole: string;
  absolutePrincipal: string;
  active: boolean;
  contributions: { principal: string; contributionPct: number }[];
}

export interface RepMonthCoverage {
  employeeCode: string;
  year: string;
  monthIndex: number;
  coverage: number;
  productiveCalls: number;
  totalCalls: number;
}

export interface PrincipalMonthTarget {
  principal: string;
  year: string;
  monthIndex: number;
  valueTarget: number;
}

/** Distinct product lines (brands/SKUs — see BrandCustomerActual.brand) a rep
 *  sold that principal-month, sourced from the same table Customer & Brand
 *  reads. Matched to a rep the same way SapRepActualInput is (by sapName —
 *  BrandCustomerActual carries no employeeCode), feeding LPPC (Lines Per
 *  Productive Call) in Rep Performance. */
export interface RepLinesInput {
  year: string;
  monthIndex: number;
  principal: string;
  sapName: string;
  lines: number;
}

export interface RepPerformanceData {
  employees: RepPerformanceEmployee[];
  coverageByRepMonth: RepMonthCoverage[];
  targets: PrincipalMonthTarget[];
  repLines: RepLinesInput[];
}

interface RawCoverageRow {
  employeeCode: string;
  monthIndex: number;
  coverage: bigint | number;
  productiveCalls: bigint | number;
  totalCalls: bigint | number;
}

interface RawLinesRow {
  year: string;
  monthIndex: number;
  principal: string;
  sapName: string;
  lines: bigint | number;
}

/** Coverage/productivity for Rep Performance come straight from RepCall (the same
 *  live Pine data the Timestamps report reads), not the Excel-sourced monthlyCoverage
 *  sheet — one absolute principal per rep-day, per lib/timestampSummary.ts's own
 *  convention, so no principal join is needed here: RepCall rows already belong to
 *  exactly one rep, and the caller attributes them to that rep's absolutePrincipal. */
export async function getRepPerformanceData(year: string, scope: TeamLeaderScope | null): Promise<RepPerformanceData> {
  const employeeWhere = scope ? { employeeCode: { in: scope.employeeCodes } } : {};
  const scopeClause =
    scope
      ? scope.employeeCodes.length > 0
        ? Prisma.sql`AND "employeeCode" IN (${Prisma.join(scope.employeeCodes)})`
        : Prisma.sql`AND false`
      : Prisma.sql``;

  const [employees, rawCoverage, targets, rawLines] = await Promise.all([
    prisma.employeeMaster.findMany({
      where: employeeWhere,
      select: {
        employeeCode: true,
        pineName: true,
        sapName: true,
        teamLeader: true,
        salesRole: true,
        absolutePrincipal: true,
        active: true,
        contributions: { select: { principal: true, contributionPct: true } },
      },
    }),
    prisma.$queryRaw<RawCoverageRow[]>(Prisma.sql`
      SELECT
        "employeeCode",
        (EXTRACT(MONTH FROM date)::int - 1) AS "monthIndex",
        COUNT(DISTINCT "outletId")::int AS coverage,
        COUNT(*) FILTER (WHERE "callOutcome" = 'Sale')::int AS "productiveCalls",
        COUNT(*)::int AS "totalCalls"
      FROM "RepCall"
      WHERE date >= ${new Date(Date.UTC(Number(year), 0, 1))} AND date < ${new Date(Date.UTC(Number(year) + 1, 0, 1))}
      ${scopeClause}
      GROUP BY "employeeCode", "monthIndex"
    `),
    prisma.target.findMany({
      where: { year, ...(scope ? { principal: { in: scope.principals } } : {}) },
      select: { principal: true, monthIndex: true, valueTarget: true },
    }),
    prisma.$queryRaw<RawLinesRow[]>(Prisma.sql`
      SELECT year, "monthIndex", principal, "sapName", COUNT(DISTINCT brand)::int AS lines
      FROM "BrandCustomerActual"
      WHERE year = ${year}
      ${scope ? Prisma.sql`AND principal IN (${Prisma.join(scope.principals.length > 0 ? scope.principals : ["__none__"])})` : Prisma.sql``}
      GROUP BY year, "monthIndex", principal, "sapName"
    `),
  ]);

  return {
    employees: employees.map((e) => ({ ...e, contributions: e.contributions })),
    coverageByRepMonth: rawCoverage.map((row) => ({
      employeeCode: row.employeeCode,
      year,
      monthIndex: row.monthIndex,
      coverage: Number(row.coverage),
      productiveCalls: Number(row.productiveCalls),
      totalCalls: Number(row.totalCalls),
    })),
    targets: targets.map((t) => ({ principal: t.principal, year, monthIndex: t.monthIndex, valueTarget: t.valueTarget ?? 0 })),
    repLines: rawLines.map((row) => ({ year: row.year, monthIndex: row.monthIndex, principal: row.principal, sapName: row.sapName, lines: Number(row.lines) })),
  };
}

// ---------------------------------------------------------------------------
// Pure merge/rollup logic — kept DB-free so it's directly unit-testable.
// ---------------------------------------------------------------------------

export interface SapRepActualInput {
  year: string;
  monthIndex: number;
  principal: string;
  sapName: string;
  employeeCode: string | null;
  employeeName: string | null;
  salesRole: string | null;
  cases: number;
  revenue: number;
  grossProfit: number;
}

export interface RepPerformanceRow {
  employeeCode: string | null;
  employeeName: string;
  teamLeader: string | null;
  salesRole: string;
  /** null when this rep's absolute principal doesn't match an active principal filter — not zero, since zero would misreport actual coverage as none. */
  coverage: number | null;
  productiveCalls: number | null;
  productivityPct: number | null;
  cases: number;
  revenue: number;
  grossProfit: number;
  grossMarginPct: number | null;
  /** Distinct product lines (brands) sold across the selected months/principal —
   *  see RepLinesInput. Summed across months the same (unaveraged) way cases/
   *  revenue are, so it stays additive across the selected period. */
  lines: number;
  /** Cases per productive call — average volume delivered per productive visit.
   *  Null when there's no productiveCalls to divide by (non-Primary reps, or a
   *  rep with zero coverage this period). */
  dropSize: number | null;
  /** Lines Per Productive Call: distinct lines sold ÷ productive calls — an
   *  approximation, since BrandCustomerActual is a monthly aggregate rather than
   *  per-call transaction detail; it's "distinct lines sold that month ÷
   *  productive calls that month", summed across the selected period, not a
   *  true per-visit line count. Null under the same conditions as dropSize. */
  lppc: number | null;
  /** null only for non-Primary reps, where a target doesn't apply at all. */
  target: number | null;
  achievementPct: number | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Coverage/productiveCalls are averaged across the selected months, never
 *  summed — coverage counts unique outlets and the same outlets get revisited
 *  every month (see [[project_coverage_averaging_rule]]). Productivity is then
 *  derived from those two averaged totals, matching the existing Excel-sourced
 *  summarizeCoverageByRep's own approach. */
export function averageRepCoverage(
  rows: { coverage: number; productiveCalls: number }[]
): { coverage: number; productiveCalls: number; productivityPct: number } {
  const n = rows.length;
  const coverage = n > 0 ? Math.round(rows.reduce((s, r) => s + r.coverage, 0) / n) : 0;
  const productiveCalls = n > 0 ? Math.round(rows.reduce((s, r) => s + r.productiveCalls, 0) / n) : 0;
  return { coverage, productiveCalls, productivityPct: coverage > 0 ? round1((productiveCalls / coverage) * 100) : 0 };
}

/** A rep's target = the sum, across every principal they declare a Contribution
 *  % for (narrowed to a selected principal filter when one is active), of that
 *  principal's monthly Target x their contributionPct, summed over the selected
 *  months. Since each principal's active reps' contributionPct sums to ~100%,
 *  summing every rep's share reconstructs that principal's full monthly target. */
export function computeRepTarget(
  contributions: { principal: string; contributionPct: number }[],
  targets: PrincipalMonthTarget[],
  months: { year: string; monthIndex: number }[],
  principalKey: string | null
): number {
  const monthKeys = new Set(months.map((m) => `${m.year}|${m.monthIndex}`));
  const relevant = principalKey ? contributions.filter((c) => normalizePrincipalKey(c.principal) === principalKey) : contributions;
  let total = 0;
  for (const contribution of relevant) {
    for (const t of targets) {
      if (t.principal !== contribution.principal) continue;
      if (!monthKeys.has(`${t.year}|${t.monthIndex}`)) continue;
      total += t.valueTarget * contribution.contributionPct;
    }
  }
  return total;
}

function nameFallbackKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface BuildRepPerformanceRowsParams {
  employees: RepPerformanceEmployee[];
  coverageByRepMonth: RepMonthCoverage[];
  targets: PrincipalMonthTarget[];
  sapRows: SapRepActualInput[];
  repLines: RepLinesInput[];
  months: { year: string; monthIndex: number }[];
  /** Normalized (lib/normalize.ts's normalizePrincipalKey), or null for "All Principals". */
  principalKey: string | null;
  teamLeaderFilter: string | null;
  salesRoleFilter: "Primary Sales" | "Secondary Sales" | null;
}

/** Assembles the Rep Performance table: EmployeeMaster is the seed (employeeCode
 *  is now a real join key, replacing the old fuzzy name match), SAP actuals are
 *  overlaid by employeeCode, coverage/productivity come from RepCall attributed
 *  to each rep's absolute principal, and target is the Contribution%-weighted
 *  sum of every principal a Primary rep serves. */
export function buildRepPerformanceRows(params: BuildRepPerformanceRowsParams): RepPerformanceRow[] {
  const { employees, coverageByRepMonth, targets, sapRows, repLines, months, principalKey, teamLeaderFilter, salesRoleFilter } = params;
  const monthKeys = new Set(months.map((m) => `${m.year}|${m.monthIndex}`));

  const rows = new Map<string, RepPerformanceRow & { employeeCode: string }>();

  for (const employee of employees) {
    if (teamLeaderFilter && employee.teamLeader !== teamLeaderFilter) continue;
    if (salesRoleFilter && employee.salesRole !== salesRoleFilter) continue;

    const absoluteMatches = !principalKey || normalizePrincipalKey(employee.absolutePrincipal) === principalKey;
    const matchingContributions = principalKey
      ? employee.contributions.filter((c) => normalizePrincipalKey(c.principal) === principalKey)
      : employee.contributions;
    if (principalKey && !absoluteMatches && matchingContributions.length === 0) continue;

    let coverage: number | null = null;
    let productiveCalls: number | null = null;
    let productivityPct: number | null = null;
    if (absoluteMatches) {
      const repMonths = coverageByRepMonth.filter((r) => r.employeeCode === employee.employeeCode && monthKeys.has(`${r.year}|${r.monthIndex}`));
      const avg = averageRepCoverage(repMonths);
      coverage = avg.coverage;
      productiveCalls = avg.productiveCalls;
      productivityPct = avg.productivityPct;
    }

    const target = employee.salesRole === "Primary Sales" ? computeRepTarget(matchingContributions, targets, months, principalKey) : null;

    rows.set(employee.employeeCode, {
      employeeCode: employee.employeeCode,
      employeeName: employee.pineName,
      teamLeader: employee.teamLeader,
      salesRole: employee.salesRole,
      coverage,
      productiveCalls,
      productivityPct,
      cases: 0,
      revenue: 0,
      grossProfit: 0,
      grossMarginPct: null,
      lines: 0,
      dropSize: null,
      lppc: null,
      target,
      achievementPct: null,
    });
  }

  const employeeByFallbackKey = new Map(employees.map((e) => [nameFallbackKey(e.pineName), e.employeeCode]));
  const unmatched = new Map<string, RepPerformanceRow>();

  for (const row of sapRows) {
    if (!monthKeys.has(`${row.year}|${row.monthIndex}`)) continue;
    if (principalKey && normalizePrincipalKey(row.principal) !== principalKey) continue;

    const label = row.employeeName || row.sapName;
    const matchedCode = row.employeeCode ?? employeeByFallbackKey.get(nameFallbackKey(label));
    const existing = matchedCode ? rows.get(matchedCode) : undefined;

    if (existing) {
      existing.cases += row.cases;
      existing.revenue += row.revenue;
      existing.grossProfit += row.grossProfit;
      existing.grossMarginPct = existing.revenue > 0 ? round1((existing.grossProfit / existing.revenue) * 100) : null;
      continue;
    }

    // Unmatched SAP revenue: no EmployeeMaster row exists for this rep, so
    // team leader/role are unknown — excluded entirely when either filter is
    // active, since we can't honestly place them in a filtered slice.
    if (teamLeaderFilter) continue;
    if (salesRoleFilter && row.salesRole !== salesRoleFilter) continue;
    const key = nameFallbackKey(label);
    const fallback = unmatched.get(key) ?? {
      employeeCode: null,
      employeeName: label,
      teamLeader: null,
      salesRole: row.salesRole ?? "Unassigned",
      coverage: null,
      productiveCalls: null,
      productivityPct: null,
      cases: 0,
      revenue: 0,
      grossProfit: 0,
      grossMarginPct: null,
      lines: 0,
      dropSize: null,
      lppc: null,
      target: null,
      achievementPct: null,
    };
    fallback.cases += row.cases;
    fallback.revenue += row.revenue;
    fallback.grossProfit += row.grossProfit;
    fallback.grossMarginPct = fallback.revenue > 0 ? round1((fallback.grossProfit / fallback.revenue) * 100) : null;
    unmatched.set(key, fallback);
  }

  // Same matched-by-employeeCode/fallback-by-name merge as sapRows above —
  // BrandCustomerActual carries only sapName, no employeeCode, so it's matched
  // the same way. Distinct-line counts are already deduped within each
  // (year, monthIndex, principal, sapName) row by the query, so summing across
  // matched rows here only combines different months/principals, never
  // double-counts the same brand within one.
  for (const row of repLines) {
    if (!monthKeys.has(`${row.year}|${row.monthIndex}`)) continue;
    if (principalKey && normalizePrincipalKey(row.principal) !== principalKey) continue;

    const matchedCode = employeeByFallbackKey.get(nameFallbackKey(row.sapName));
    const existing = matchedCode ? rows.get(matchedCode) : undefined;
    if (existing) {
      existing.lines += row.lines;
      continue;
    }

    if (teamLeaderFilter) continue;
    const key = nameFallbackKey(row.sapName);
    const fallback = unmatched.get(key);
    if (fallback) fallback.lines += row.lines;
    // No matching SAP-value row either: nothing to attach a line count to
    // without fabricating a leaderboard row for a rep with brand activity but
    // no recorded cases/revenue — dropped rather than guessed at.
  }

  const result = [...rows.values(), ...unmatched.values()].map((row) => ({
    ...row,
    achievementPct: row.target && row.target > 0 ? round1((row.revenue / row.target) * 100) : null,
    dropSize: row.productiveCalls && row.productiveCalls > 0 ? round1(row.cases / row.productiveCalls) : null,
    lppc: row.productiveCalls && row.productiveCalls > 0 ? round1(row.lines / row.productiveCalls) : null,
  }));
  return result.sort((a, b) => b.revenue - a.revenue);
}
