import type { Dataset } from "./types";
import { weightedCoverDays, stockStatus } from "./parseWorkbook";

export interface StockPrincipalRollup {
  key: string;
  name: string;
  volume: number;
  pcs: number;
  value: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  itemCount: number;
  outOfStockCount: number;
  runningOutCount: number;
  okCount: number;
  noDataCount: number;
  daysStock: number;
  action: string;
}

/** Groups item-level stock rows by normalized brand key, independent of how many
 *  regional "Principal" rows in Sales Vs Target share that key. */
export function aggregateStockByPrincipal(dataset: Dataset): StockPrincipalRollup[] {
  const byKey = new Map<string, StockPrincipalRollup>();

  for (const item of dataset.stockItems) {
    let agg = byKey.get(item.key);
    if (!agg) {
      agg = {
        key: item.key,
        name: item.principal.split("-")[0].trim(),
        volume: 0,
        pcs: 0,
        value: 0,
        rrWeekValue: 0,
        rrWeekVolume: 0,
        itemCount: 0,
        outOfStockCount: 0,
        runningOutCount: 0,
        okCount: 0,
        noDataCount: 0,
        daysStock: 0,
        action: "",
      };
      byKey.set(item.key, agg);
    }
    agg.volume += item.openingVolume;
    agg.pcs += item.openingPcs;
    agg.value += item.openingValue;
    agg.rrWeekValue += item.rrWeekValue;
    agg.rrWeekVolume += item.rrWeekVolume;
    agg.itemCount += 1;
    if (item.action.includes("\u{1F534}")) agg.outOfStockCount += 1;
    else if (item.action.includes("\u{1F7E1}")) agg.runningOutCount += 1;
    else if (item.action.includes("\u{1F7E2}")) agg.okCount += 1;
    else agg.noDataCount += 1;
  }

  const rollups = Array.from(byKey.values());
  for (const agg of rollups) {
    agg.daysStock = weightedCoverDays(agg.value, agg.rrWeekValue);
    agg.action = stockStatus(agg.daysStock, agg.value, agg.rrWeekValue);
  }
  return rollups;
}
