import { OUT_OF_STOCK_DAYS, RUNNING_OUT_DAYS } from "./stockThresholds";
import type { Dataset, DormantStockItem, StockItem, StockTotal } from "./types";

function stockTotalFromItems(stockItems: StockItem[]): StockTotal {
  let volume = 0, pcs = 0, value = 0, rrWeekValue = 0, rrWeekVolume = 0;
  let outOfStockCount = 0, runningOutCount = 0, okCount = 0, noDataCount = 0;
  for (const item of stockItems) {
    volume += item.openingVolume;
    pcs += item.openingPcs;
    value += item.openingValue;
    rrWeekValue += item.rrWeekValue;
    rrWeekVolume += item.rrWeekVolume;
    if (item.action.includes("🔴")) outOfStockCount += 1;
    else if (item.action.includes("🟡")) runningOutCount += 1;
    else if (item.action.includes("🟢")) okCount += 1;
    else noDataCount += 1;
  }
  const daysStock = value > 0 && rrWeekValue > 0 ? Math.round(((value / rrWeekValue) * 7) * 10) / 10 : 0;
  const action = value <= 0 ? "🔴 Out of Stock - To Order" : rrWeekValue <= 0 ? "⚪ No Sales Data" : daysStock < OUT_OF_STOCK_DAYS ? "🔴 Out of Stock - To Order" : daysStock < RUNNING_OUT_DAYS ? "🟡 Running Out" : "🟢 OK";
  return { volume, pcs, value, rrWeekValue, rrWeekVolume, daysStock, itemCount: stockItems.length, outOfStockCount, runningOutCount, okCount, noDataCount, action };
}

/** Adds the stock held outside the operational Stock Balance to a stock total's value, pieces and item count: dormant SKUs (stock on
 *  hand with no movement in three months) and returnable empties. The operational screens leave those out, but Finance and Overview
 *  show all stock held; the status counts and cover days stay those of the operational stock. */
export function withDormantHeldStock(total: StockTotal, dormantStockItems: DormantStockItem[] | undefined, emptiesStockItems?: StockItem[]): StockTotal {
  const dormantHeld = (dormantStockItems ?? []).filter((item) => item.openingPcs > 0);
  const empties = emptiesStockItems ?? [];
  if (dormantHeld.length === 0 && empties.length === 0) return total;
  return {
    ...total,
    value: total.value + dormantHeld.reduce((sum, item) => sum + item.openingValue, 0) + empties.reduce((sum, item) => sum + item.openingValue, 0),
    pcs: total.pcs + dormantHeld.reduce((sum, item) => sum + item.openingPcs, 0) + empties.reduce((sum, item) => sum + item.openingPcs, 0),
    itemCount: total.itemCount + dormantHeld.length + empties.length,
  };
}

/** Browser-safe dataset scoping shared by the global multi-principal filter. */
export function filterDatasetToPrincipals(dataset: Dataset, principalKeys: Set<string>): Dataset {
  const monthlySales = dataset.monthlySales.filter((row) => principalKeys.has(row.principalKey));
  const monthlyCoverage = dataset.monthlyCoverage.filter((row) => principalKeys.has(row.principalKey));
  const monthlyBrandCustomer = dataset.monthlyBrandCustomer.filter((row) => principalKeys.has(row.principalKey));
  const monthlyPL = dataset.monthlyPL.filter((row) => principalKeys.has(row.principalKey));
  const stockItems = dataset.stockItems.filter((item) => principalKeys.has(item.key));
  const dormantStockItems = dataset.dormantStockItems?.filter((item) => principalKeys.has(item.key));
  const emptiesStockItems = dataset.emptiesStockItems?.filter((item) => principalKeys.has(item.key));
  return { ...dataset, monthlySales, monthlyCoverage, monthlyBrandCustomer, monthlyPL, stockItems, dormantStockItems, emptiesStockItems, stockTotal: withDormantHeldStock(stockTotalFromItems(stockItems), dormantStockItems, emptiesStockItems) };
}
