// The analysis input: the rows of the Active Outlets extract (the principal view, active outlets only: the same query and the same tiering and place
// cleaning as /api/outlet-universe/export), with the strike columns taken for ONE calendar month instead of the year to date.
import { OUTLET_SOURCE_LABELS, buyingTenure, boughtWithin, purchaseConsistency, type OutletSource } from "@/lib/outletUniverse/normalize";
import { exportOutlets, parseOutletFilters, type OutletScope } from "@/lib/outletUniverse/query";
import { buildNameProfiles, classification2, cleanPlaces, tierRow } from "@/lib/outletUniverse/tiering";
import { cleanLocation, getUnifiedLocations } from "@/lib/locationUnify/source";
import { LOW_STRIKE_WINDOW_MONTHS, PRIMARY } from "./config";
import { monthCounts, principalMonthStrike, windowCounts, type MonthlyStrike } from "./monthlyStrike";
import { recordKey } from "./pipeline";
import type { ExtractRow } from "./types";

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface ExtractInput {
  rows: ExtractRow[];
  /** Sources with no call data at all in the analysed month (left out of strike rather than shown as 0%). */
  sourcesWithoutCalls: string[];
}

/** Months (0..11) with call data from at least one source that records an outcome. */
export function monthsWithStrikeData(data: MonthlyStrike): number[] {
  const months = new Set<number>();
  for (const [source, set] of data.monthsWithData) if (source !== "LEVERAGE") for (const m of set) months.add(m);
  return [...months].sort((a, b) => a - b);
}

export async function loadExtractRows(scope: OutletScope, strike: MonthlyStrike, monthIndex: number): Promise<ExtractInput> {
  const base = parseOutletFilters(new URLSearchParams({ view: "principal" }));
  const [rows, universe] = await Promise.all([
    exportOutlets({ ...base, status: "active" }, scope),
    exportOutlets({ ...base, status: "all" }, scope, { withMix: false }),
  ]);
  const profiles = buildNameProfiles(universe);
  const unifiedLocations = await getUnifiedLocations();
  const now = new Date();
  const hasMonth = (source: OutletSource) => strike.monthsWithData.get(source)?.has(monthIndex) ?? false;
  const sourcesWithoutCalls = (Object.keys(OUTLET_SOURCE_LABELS) as OutletSource[]).filter((s) => s !== "LEVERAGE" && !hasMonth(s)).map((s) => OUTLET_SOURCE_LABELS[s]);

  const out: ExtractRow[] = rows.map((row) => {
    const tenure = buyingTenure(row.firstPurchaseDate, now);
    const tiered = tierRow(row, profiles);
    const places = cleanPlaces(row);
    const daysSince = row.lastPurchaseDate ? Math.max(0, Math.floor((now.getTime() - new Date(row.lastPurchaseDate).getTime()) / 86_400_000)) : null;
    const source = row.source as OutletSource;
    const label = OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source;
    const principal = row.principals;

    // Strike for the month: calls and productive calls where the source records an outcome for that month, otherwise null (left out of strike).
    const outcomeKnown = source !== "LEVERAGE" && hasMonth(source);
    const month = monthCounts(strike, source, principal, row.outletKey, monthIndex);
    const recent = windowCounts(strike, source, principal, row.outletKey, monthIndex, LOW_STRIKE_WINDOW_MONTHS);
    const calls = source === "LEVERAGE" ? month.calls : outcomeKnown ? month.calls : null;
    const productive = outcomeKnown ? month.productive : null;
    return {
      source: label,
      outletId: String(row.outletKey).trim(),
      outlet: row.outletName,
      principal,
      routeClass: classification2(row.salesRole),
      channel: tiered.channel,
      segment: tiered.segment,
      region: places.region,
      territory: cleanLocation(unifiedLocations, places.territory).canonical,
      route: row.route,
      rep: row.repName,
      lat: row.latitude,
      lon: row.longitude,
      lastPurchase: row.lastPurchaseDate ? String(row.lastPurchaseDate).slice(0, 10) : null,
      daysSince,
      sales: row.sales,
      avgSales: tiered.averageSales,
      tx: row.transactions,
      buyingSince: row.firstPurchaseDate ? String(row.firstPurchaseDate).slice(0, 10) : null,
      monthsBuying: tenure.months,
      tenure: tenure.band,
      periods3: row.periodsBought90,
      consistency: purchaseConsistency(row.periodsBought90),
      tier: tiered.tier,
      combinedAvg: tiered.combinedAverage,
      bought30: boughtWithin(row.lastPurchaseDate, 30, now) ? "Yes" : "No",
      matchId: row.matchId,
      matchConf: row.matchConfidence,
      teamLeader: row.teamLeader,
      repRegion: row.repRegion,
      repSubregion: row.repSubRegion,
      calls,
      productive,
      strike: calls !== null && productive !== null && calls > 0 ? Math.round((productive / calls) * 1000) / 10 : null,
      callsRecent: outcomeKnown ? recent.calls : null,
      productiveRecent: outcomeKnown ? recent.productive : null,
      principalStrike: outcomeKnown ? principalMonthStrike(strike, source, principal, monthIndex) : null,
      recKey: recordKey(label, String(row.outletKey)),
      isDirect: classification2(row.salesRole) === PRIMARY,
    };
  });
  return { rows: out, sourcesWithoutCalls };
}
