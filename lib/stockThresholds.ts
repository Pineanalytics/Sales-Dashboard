// The stock status tiers, in days of cover (stock value / weekly run-rate x 7). Kept apart from lib/parseWorkbook.ts
// (which pulls in the Excel parser) so the browser-side dataset code can share the same numbers.

/** A SKU is Out of Stock only when it has less than this many days of cover (or no stock at all). */
export const OUT_OF_STOCK_DAYS = 2;

/** From OUT_OF_STOCK_DAYS up to this many days of cover a SKU is Running Out; at or above it, OK. */
export const RUNNING_OUT_DAYS = 14;
