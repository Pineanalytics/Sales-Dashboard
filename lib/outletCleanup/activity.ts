// Whether an outlet is still buying: the Active Outlets module's own rule (bought within the activity window, 90 days), with the dormant ones told apart the way the module does.
import { OUTLET_ACTIVE_WINDOW_DAYS, dormancyFlag } from "@/lib/outletUniverse/normalize";
import type { OutletActivity } from "./types";

/** Active, or dormant: Lapsed (silent past the window), Lost (silent for the module's lost-after period) or No purchase (nothing on record this year). */
export function outletActivity(lastPurchase: Date | string | null, now: Date = new Date()): { activity: OutletActivity; daysSince: number | null } {
  const flag = dormancyFlag(lastPurchase, now, OUTLET_ACTIVE_WINDOW_DAYS);
  if (!flag) return { activity: "ACTIVE", daysSince: lastPurchase ? Math.floor((now.getTime() - new Date(lastPurchase).getTime()) / 86_400_000) : null };
  return { activity: flag.flag === "Lost" ? "LOST" : flag.flag === "Lapsed" ? "LAPSED" : "NO_PURCHASE", daysSince: flag.daysSince };
}

export const ACTIVITY_LABELS: Record<OutletActivity, string> = { ACTIVE: "Active", LAPSED: "Dormant", LOST: "Lost", NO_PURCHASE: "No purchase" };

/** The earliest purchase date that still counts as active: the start of the day 90 days back, so the filter agrees with the whole-days rule above (an outlet whose last purchase was exactly 90 days ago is still active). */
export const activeCutoffDate = (now: Date = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - OUTLET_ACTIVE_WINDOW_DAYS));
