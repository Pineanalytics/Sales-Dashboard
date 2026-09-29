import { isOverstocked, OVERSTOCK_DAYS_THRESHOLD } from "@/lib/stock";

// Same fixed top-5 principal set used across the dashboard for high-margin/
// high-priority reporting (see components/financials/SalesPerformanceTab.tsx)
// — kept here too so the Must-Sell List and Top 5 Stock Status tabs agree
// with Finance's own definition of "the top 5."
export const TOP_5_STOCK_PRINCIPALS = ["Mars", "Suntory", "Upfield", "Eabl", "Weetabix"];

/** Plain-language stocking action derived from the same status/overstock
 *  axes already computed for every rollup (lib/stock.ts's stockStatus /
 *  isOverstocked) — no new data, just a recommendation layered on top. */
export function getStockRecommendation(rollup: { action: string; rrWeekValue: number; daysStock: number } | null): string {
  if (!rollup) return "No stock on hand — verify sourcing";
  if (isOverstocked({ rrWeekValue: rollup.rrWeekValue, daysCover: rollup.daysStock }, OVERSTOCK_DAYS_THRESHOLD)) {
    return "Reduce — hold further shipments";
  }
  if (rollup.action.includes("🔴")) return "Reorder urgently";
  if (rollup.action.includes("🟡")) return "Reorder soon";
  if (rollup.rrWeekValue <= 0) return "Monitor — no recent sales";
  return "Maintain current stocking";
}
