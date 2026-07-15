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
  unassignedRevenueReps: number; // reps with JPMonthlySplitRow revenue but no TeamLeaderAssignment for that principal
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
  const [splitRows, assignments] = await Promise.all([
    prisma.jPMonthlySplitRow.groupBy({ by: ["costCentre", "employeeCode", "employeeName"], _sum: { revenue: true } }),
    prisma.teamLeaderAssignment.findMany(),
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
  for (const row of splitRows) {
    const reps = repsByPrincipal.get(row.costCentre);
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
  const [splitRows, assignments] = await Promise.all([
    prisma.jPMonthlySplitRow.groupBy({ by: ["costCentre", "employeeCode", "employeeName"], _sum: { revenue: true } }),
    prisma.teamLeaderAssignment.findMany({ select: { principal: true, employeeCode: true } }),
  ]);
  const assignedKeys = new Set(assignments.map((a) => `${a.principal}|${a.employeeCode}`));

  return splitRows
    .filter((r) => (r._sum.revenue ?? 0) > 0 && !assignedKeys.has(`${r.costCentre}|${r.employeeCode}`))
    .map((r) => ({ principal: r.costCentre, employeeCode: r.employeeCode, employeeName: r.employeeName, revenue: r._sum.revenue ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue);
}

// Below this, a rep's "preceding week" signal is too thin to trust (e.g. they
// were on leave most of the week) — fall back to the deeper-history layer.
const MIN_DETAIL_VISITS_FOR_LAYER_1 = 3;
const EVEN_WEEKDAY_SPLIT = [0.2, 0.2, 0.2, 0.2, 0.2];

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
 *  Layer 1: JPAdherenceDetail.productiveFlag over whatever's stored (kept to the
 *  most recent RECENT_UPLOAD_DAYS=7 — effectively "last week" already). Layer 2:
 *  JPAdherenceDaily.totalActualVisits by weekday-of-date, which — unlike Detail —
 *  stays full-90-day, so it's real trailing history even though it can't split
 *  productive-vs-not the way Detail can. See computeWeekdayWeights for the
 *  fallback logic itself. */
async function weekdayWeightsForRep(employeeCode: string): Promise<number[]> {
  const detailRows = await prisma.jPAdherenceDetail.findMany({
    where: { employeeCode, productiveFlag: true },
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

  const dailyRows = await prisma.jPAdherenceDaily.findMany({
    where: { employeeCode },
    select: { date: true, totalActualVisits: true },
  });
  const dailyCounts = [0, 0, 0, 0, 0];
  for (const r of dailyRows) {
    const idx = weekdayIndex(r.date);
    if (idx !== null) dailyCounts[idx] += r.totalActualVisits;
  }

  return computeWeekdayWeights(detailCounts, dailyCounts);
}

export interface DailyTargetResult {
  weeklyTargetsProcessed: number;
  dailyRowsCreated: number;
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
    prisma.teamLeaderAssignment.findMany(),
    prisma.repContribution.findMany(),
  ]);

  const repsByTeamLeaderPrincipal = new Map<string, { employeeCode: string; employeeName: string }[]>();
  for (const a of assignments) {
    const key = `${a.teamLeaderId}|${a.principal}`;
    const list = repsByTeamLeaderPrincipal.get(key) ?? [];
    list.push({ employeeCode: a.employeeCode, employeeName: a.employeeName });
    repsByTeamLeaderPrincipal.set(key, list);
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
      const sharePct = shareByPrincipalRep.get(`${wt.principal}|${rep.employeeCode}`) ?? 1 / reps.length;
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
