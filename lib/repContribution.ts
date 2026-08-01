// Contribution-by-Rep + Daily Projection recompute, triggered as the final step
// of the JP Adherence sync (via app/api/jp-adherence/recompute-derived) rather
// than living in scripts/db-bridge/jp-adherence/run.ts itself — the script only
// ever talks to the "pine" MySQL source, while this step needs TeamLeaderAssignment
// and WeeklyTarget, which live in this app's own Postgres DB. Running it inside
// the Next.js app (which already has Prisma access) avoids a round-trip that
// would otherwise have to ship TeamLeaderAssignment data back out to the script
// just to ship it straight back in again.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function weekdayIndex(date: Date): number | null {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5 ? day - 1 : null; // 0=Mon..4=Fri, null for Sat/Sun
}

export interface RepContributionResult {
  principalCount: number;
  repCount: number;
  unassignedRevenueReps: number; // reps with SAP revenue but no TeamLeaderAssignment for that principal
}

function trailingMonthWhere(now = new Date()): { OR: { year: string; monthIndex: number }[] } {
  const periods: { year: string; monthIndex: number }[] = [];
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    periods.push({ year: String(date.getUTCFullYear()), monthIndex: date.getUTCMonth() });
  }
  return { OR: periods };
}

/** Pure share-normalization: proportional to revenue when the group has any
 *  positive revenue, else an even split (so a principal where every assigned
 *  rep is at 0 still produces something for DailyTarget to distribute against,
 *  rather than every rep landing on a divide-by-zero 0%). Negative revenue
 *  (shouldn't happen, but bridge data has been wrong before) is floored at 0. */
export function computeSharePcts(revenueByRep: Map<string, number>): Map<string, number> {
  const total = Array.from(revenueByRep.values()).reduce((s, r) => s + Math.max(r, 0), 0);
  const shares = new Map<string, number>();
  for (const [employeeCode, revenue] of revenueByRep) {
    shares.set(employeeCode, total > 0 ? Math.max(revenue, 0) / total : 1 / revenueByRep.size);
  }
  return shares;
}

/** sharePct[rep] = rep's share of trailing revenue among reps assigned
 *  (TeamLeaderAssignment) to that principal. Every assigned rep gets a row even
 *  at 0 revenue (share 0), and a principal where every assigned rep has 0
 *  revenue falls back to an even split so DailyTarget still has something to
 *  distribute against. Full-replace every call, same pattern as JPMonthlySplitRow. */
export async function recomputeRepContribution(): Promise<RepContributionResult> {
  const [salesRows, assignments] = await Promise.all([
    prisma.salesRepActual.groupBy({
      by: ["principal", "employeeCode", "employeeName"],
      where: { ...trailingMonthWhere(), employeeCode: { not: null } },
      _sum: { revenue: true },
    }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true } }),
  ]);

  const assignmentKey = (principal: string, employeeCode: string) => `${principal}|${employeeCode}`;
  const teamLeaderByAssignment = new Map<string, string>();
  const repsByPrincipal = new Map<string, Map<string, { employeeName: string; revenue: number }>>();
  for (const a of assignments) {
    const key = assignmentKey(a.principal, a.employeeCode);
    if (!teamLeaderByAssignment.has(key)) teamLeaderByAssignment.set(key, a.teamLeaderId);
    const reps = repsByPrincipal.get(a.principal) ?? new Map();
    if (!reps.has(a.employeeCode)) reps.set(a.employeeCode, { employeeName: a.employeeName, revenue: 0 });
    repsByPrincipal.set(a.principal, reps);
  }

  let unassignedRevenueReps = 0;
  for (const row of salesRows) {
    if (!row.employeeCode) continue;
    const reps = repsByPrincipal.get(row.principal);
    const rep = reps?.get(row.employeeCode);
    if (!rep) {
      if ((row._sum.revenue ?? 0) > 0) unassignedRevenueReps += 1;
      continue;
    }
    rep.revenue += row._sum.revenue ?? 0;
  }

  const toCreate: Prisma.RepContributionCreateManyInput[] = [];
  for (const [principal, reps] of repsByPrincipal) {
    const revenueByRep = new Map(Array.from(reps, ([employeeCode, rep]) => [employeeCode, rep.revenue]));
    const shares = computeSharePcts(revenueByRep);
    for (const [employeeCode, rep] of reps) {
      toCreate.push({
        principal,
        employeeCode,
        employeeName: rep.employeeName,
        teamLeaderId: teamLeaderByAssignment.get(assignmentKey(principal, employeeCode)) ?? null,
        quarterRevenue: rep.revenue,
        sharePct: shares.get(employeeCode)!,
      });
    }
  }

  await prisma.$transaction([prisma.repContribution.deleteMany({}), prisma.repContribution.createMany({ data: toCreate })]);

  return { principalCount: repsByPrincipal.size, repCount: toCreate.length, unassignedRevenueReps };
}

export interface UnassignedRevenueRep {
  principal: string;
  employeeCode: string;
  employeeName: string;
  revenue: number;
}

/** Read-only companion to recomputeRepContribution's assignment-gap check, for
 *  display on /weekly-targets/contribution — reps with real JPMonthlySplitRow
 *  revenue under a principal but no TeamLeaderAssignment row for it, so their
 *  revenue isn't represented in anyone's Contribution split. */
export async function getUnassignedRevenueReps(): Promise<UnassignedRevenueRep[]> {
  const [salesRows, assignments] = await Promise.all([
    prisma.salesRepActual.groupBy({
      by: ["principal", "employeeCode", "employeeName"],
      where: { ...trailingMonthWhere(), employeeCode: { not: null } },
      _sum: { revenue: true },
    }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { principal: true, employeeCode: true } }),
  ]);
  const assignedKeys = new Set(assignments.map((a) => `${a.principal}|${a.employeeCode}`));

  return salesRows
    .filter((r) => r.employeeCode && (r._sum.revenue ?? 0) > 0 && !assignedKeys.has(`${r.principal}|${r.employeeCode}`))
    .map((r) => ({ principal: r.principal, employeeCode: r.employeeCode!, employeeName: r.employeeName ?? r.employeeCode!, revenue: r._sum.revenue ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Below this, a rep's "preceding week" signal is too thin to trust (e.g. they
// were on leave most of the week) — fall back to the deeper-history layer.
const MIN_DETAIL_VISITS_FOR_LAYER_1 = 3;
const EVEN_WEEKDAY_SPLIT = [0.2, 0.2, 0.2, 0.2, 0.2];
// Layer 1 needs to stay a genuinely *recent* signal — RepCall's own 3-month
// retention is too wide a window for MIN_DETAIL_VISITS_FOR_LAYER_1's "too thin
// to trust" threshold to mean anything (every active rep would trivially
// clear 3 visits against 3 months of history, so Layer 2/3 would never fire).
const WEEKDAY_WEIGHT_LOOKBACK_DAYS = 14;

/** Pure 3-layer fallback, given precomputed Mon-Fri count arrays (length 5) for
 *  each source: Layer 1 (most precise) — Detail's productive-visit counts, used
 *  when it has at least MIN_DETAIL_VISITS_FOR_LAYER_1 total. Layer 2 (deeper
 *  history, coarser signal) — Daily's total-visit counts. Layer 3 — an even
 *  split when the rep has no usable history in either source. */
export function computeWeekdayWeights(detailCounts: number[], dailyCounts: number[]): number[] {
  const detailTotal = detailCounts.reduce((s, c) => s + c, 0);
  if (detailTotal >= MIN_DETAIL_VISITS_FOR_LAYER_1) {
    return detailCounts.map((c) => c / detailTotal);
  }

  const dailyTotal = dailyCounts.reduce((s, c) => s + c, 0);
  if (dailyTotal > 0) {
    return dailyCounts.map((c) => c / dailyTotal);
  }

  return EVEN_WEEKDAY_SPLIT;
}

/** Weekday (Mon-Fri) visit-count histogram for one rep, normalized to sum 1.
 *  Both layers now read RepCall (Timestamps' own live data) instead of the
 *  retired JPAdherenceDetail/JPAdherenceDaily tables. Layer 1: productive
 *  (callOutcome='Sale') calls in the trailing WEEKDAY_WEIGHT_LOOKBACK_DAYS —
 *  a genuinely recent signal, matching the original Detail table's own
 *  trailing-~7-day persisted window. Layer 2: every RepCall row for the rep
 *  (unbounded beyond RepCall's own 3-month retention) — deeper history,
 *  coarser signal, same role as the old Daily-sourced layer. See
 *  computeWeekdayWeights for the fallback logic itself. */
async function weekdayWeightsForRep(employeeCode: string): Promise<number[]> {
  const lookbackStart = new Date(Date.now() - WEEKDAY_WEIGHT_LOOKBACK_DAYS * 86400000);
  const detailRows = await prisma.repCall.findMany({
    where: { employeeCode, callOutcome: "Sale", date: { gte: lookbackStart } },
    select: { date: true },
  });
  const detailCounts = [0, 0, 0, 0, 0];
  for (const r of detailRows) {
    const idx = weekdayIndex(r.date);
    if (idx !== null) detailCounts[idx] += 1;
  }

  const detailTotal = detailCounts.reduce((s, c) => s + c, 0);
  if (detailTotal >= MIN_DETAIL_VISITS_FOR_LAYER_1) {
    return computeWeekdayWeights(detailCounts, [0, 0, 0, 0, 0]);
  }

  const dailyRows = await prisma.repCall.findMany({
    where: { employeeCode },
    select: { date: true },
  });
  const dailyCounts = [0, 0, 0, 0, 0];
  for (const r of dailyRows) {
    const idx = weekdayIndex(r.date);
    if (idx !== null) dailyCounts[idx] += 1;
  }

  return computeWeekdayWeights(detailCounts, dailyCounts);
}

export interface DailyTargetResult {
  weeklyTargetsProcessed: number;
  dailyRowsCreated: number;
}

export interface ContributionTotalWarning {
  principal: string;
  totalPct: number; // 0-100
}

/** Mirrors Target_Management_System.xlsm's ValidateContributionTotals: for each Principal
 *  where every active rep has declared a Contribution %, flags it if the total is off by more
 *  than ±0.1% from 100%. Principals still mid-setup (any active rep still null) are skipped
 *  entirely rather than nagged — declaring contribution % is meant to be gradual, one rep at a
 *  time, not all-or-nothing. Pure so the threshold is unit-testable independent of the DB. */
export function validateContributionTotals(
  assignments: { principal: string; active: boolean; contributionPct: number | null }[]
): ContributionTotalWarning[] {
  const byPrincipal = new Map<string, { contributionPct: number | null }[]>();
  for (const a of assignments) {
    if (!a.active) continue;
    const list = byPrincipal.get(a.principal) ?? [];
    list.push({ contributionPct: a.contributionPct });
    byPrincipal.set(a.principal, list);
  }

  const warnings: ContributionTotalWarning[] = [];
  for (const [principal, reps] of byPrincipal) {
    if (reps.length === 0 || reps.some((r) => r.contributionPct == null)) continue;
    const total = reps.reduce((sum, r) => sum + (r.contributionPct ?? 0), 0);
    if (Math.abs(total - 1) > 0.001) warnings.push({ principal, totalPct: total * 100 });
  }
  return warnings.sort((a, b) => a.principal.localeCompare(b.principal));
}

/** Resolution order for a rep's weekly-target share: the admin-declared Contribution %
 *  (TeamLeaderAssignment.contributionPct, ported from Target_Management_System.xlsm's Roster
 *  sheet) wins when set; else the computed RepContribution.sharePct (actual trailing-revenue
 *  share); else an even split among the principal's assigned reps. Pure so the precedence
 *  itself is unit-testable independent of the DB. */
export function resolveRepSharePct(declaredPct: number | null | undefined, computedSharePct: number | null | undefined, evenSplit: number): number {
  return declaredPct ?? computedSharePct ?? evenSplit;
}

/** Rebuilds DailyTarget from scratch for every WeeklyTarget row currently in the
 *  grid: splits each Weekly figure across its assigned reps (RepContribution
 *  .sharePct) then across that week's Mon-Fri (weekdayWeightsForRep). Full
 *  replace — cheap, since the grid window is bounded (~13 weeks x a handful of
 *  team-leader/principal pairs), and correctness matters more than incremental
 *  update complexity here. */
export async function recomputeDailyTargets(): Promise<DailyTargetResult> {
  const [weeklyTargets, assignments, contributions] = await Promise.all([
    prisma.weeklyTarget.findMany(),
    prisma.teamLeaderAssignment.findMany({ where: { active: true } }),
    prisma.repContribution.findMany(),
  ]);

  const repsByTeamLeaderPrincipal = new Map<string, { employeeCode: string; employeeName: string }[]>();
  // Declared Contribution % (admin-set on the Roster, see TeamLeaderAssignment.contributionPct)
  // wins over the computed RepContribution.sharePct when present — it's a different concept
  // (a manually-declared allocation, not derived from actual trailing revenue), ported from
  // Target_Management_System.xlsm's Roster sheet. Null means "not yet declared" for that
  // rep/principal, so it falls through to the computed share as before.
  const declaredPctByPrincipalRep = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.teamLeaderId}|${a.principal}`;
    const list = repsByTeamLeaderPrincipal.get(key) ?? [];
    list.push({ employeeCode: a.employeeCode, employeeName: a.employeeName });
    repsByTeamLeaderPrincipal.set(key, list);
    if (a.contributionPct != null) declaredPctByPrincipalRep.set(`${a.principal}|${a.employeeCode}`, a.contributionPct);
  }

  const shareByPrincipalRep = new Map<string, number>();
  for (const c of contributions) shareByPrincipalRep.set(`${c.principal}|${c.employeeCode}`, c.sharePct);

  const weightCache = new Map<string, number[]>();
  async function getWeights(employeeCode: string): Promise<number[]> {
    const cached = weightCache.get(employeeCode);
    if (cached) return cached;
    const weights = await weekdayWeightsForRep(employeeCode);
    weightCache.set(employeeCode, weights);
    return weights;
  }

  const toCreate: Prisma.DailyTargetCreateManyInput[] = [];
  for (const wt of weeklyTargets) {
    const reps = repsByTeamLeaderPrincipal.get(`${wt.teamLeaderId}|${wt.principal}`) ?? [];
    if (reps.length === 0 || wt.targetValue === 0) continue;

    for (const rep of reps) {
      const sharePct = resolveRepSharePct(
        declaredPctByPrincipalRep.get(`${wt.principal}|${rep.employeeCode}`),
        shareByPrincipalRep.get(`${wt.principal}|${rep.employeeCode}`),
        1 / reps.length
      );
      const repWeeklyTarget = wt.targetValue * sharePct;
      const weights = await getWeights(rep.employeeCode);

      for (let i = 0; i < WEEKDAY_LABELS.length; i++) {
        const date = new Date(wt.weekStartDate.getTime() + i * 86400000);
        toCreate.push({
          employeeCode: rep.employeeCode,
          employeeName: rep.employeeName,
          principal: wt.principal,
          teamLeaderId: wt.teamLeaderId,
          date,
          targetValue: repWeeklyTarget * weights[i],
          weeklyTargetId: wt.id,
          sharePctUsed: sharePct,
          weekdayWeightUsed: weights[i],
        });
      }
    }
  }

  await prisma.$transaction([prisma.dailyTarget.deleteMany({}), prisma.dailyTarget.createMany({ data: toCreate })]);

  return { weeklyTargetsProcessed: weeklyTargets.length, dailyRowsCreated: toCreate.length };
}
