// Which orders each Order 360 run re-reads. An order's fulfilment status (picked, dispatched, delivered, paid) is
// attached after the day it is placed, so a run that only re-read "today" recorded each order once, before any of
// that had happened, and never updated it: every order since the last full pass showed no deliveries at all.
//
//  - FULL: the trailing three calendar months, when there is no full pass on record, one is forced, or the last one
//    is older than FULL_RESYNC_MAX_AGE_HOURS. Catches late proofs of delivery and payments on older orders.
//  - ROLLING: otherwise, from the earlier of the start of the current month and ROLLING_WINDOW_DAYS days back, so
//    the whole of the current month is refreshed on every run (and the tail of the previous month early in a month),
//    until an order has settled.
export const BACKFILL_MONTHS = 3;
export const ROLLING_WINDOW_DAYS = 21;
export const FULL_RESYNC_MAX_AGE_HOURS = 22;

export type OrderSyncMode = "full" | "rolling";

export interface OrderSyncPlan {
  mode: OrderSyncMode;
  windowStart: Date;
}

const DAY_MS = 86_400_000;

export function planOrderSyncWindow(now: Date, lastFullResyncAt: string | null, forceFull: boolean): OrderSyncPlan {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lastFull = lastFullResyncAt ? Date.parse(lastFullResyncAt) : Number.NaN;
  const stale = Number.isNaN(lastFull) || now.getTime() - lastFull > FULL_RESYNC_MAX_AGE_HOURS * 3_600_000;

  if (forceFull || stale) {
    return { mode: "full", windowStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (BACKFILL_MONTHS - 1), 1)) };
  }
  const daysBack = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ROLLING_WINDOW_DAYS * DAY_MS);
  return { mode: "rolling", windowStart: daysBack < monthStart ? daysBack : monthStart };
}
