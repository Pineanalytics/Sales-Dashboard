import type { Dataset, StockItem, StockTotal } from "./types";

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
  const action = value <= 0 || daysStock < 7 ? "🔴 Out of Stock - To Order" : rrWeekValue <= 0 ? "⚪ No Sales Data" : daysStock < 14 ? "🟡 Running Out" : "🟢 OK";
  return { volume, pcs, value, rrWeekValue, rrWeekVolume, daysStock, itemCount: stockItems.length, outOfStockCount, runningOutCount, okCount, noDataCount, action };
}

/** Browser-safe dataset scoping shared by the global multi-principal filter. */
export function filterDatasetToPrincipals(dataset: Dataset, principalKeys: Set<string>): Dataset {
  const monthlySales = dataset.monthlySales.filter((row) => principalKeys.has(row.principalKey));
  const monthlyCoverage = dataset.monthlyCoverage.filter((row) => principalKeys.has(row.principalKey));
  const monthlyBrandCustomer = dataset.monthlyBrandCustomer.filter((row) => principalKeys.has(row.principalKey));
  const monthlyPL = dataset.monthlyPL.filter((row) => principalKeys.has(row.principalKey));
  const stockItems = dataset.stockItems.filter((item) => principalKeys.has(item.key));
  return { ...dataset, monthlySales, monthlyCoverage, monthlyBrandCustomer, monthlyPL, stockItems, stockTotal: stockTotalFromItems(stockItems) };
}
