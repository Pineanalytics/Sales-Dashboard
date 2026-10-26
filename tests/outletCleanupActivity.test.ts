import { describe, expect, it } from "vitest";
import { activeCutoffDate, outletActivity } from "../lib/outletCleanup/activity";

const NOW = new Date("2026-10-26T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("outlet activity", () => {
  it("calls an outlet that bought in the last 90 days active", () => {
    expect(outletActivity(ago(3), NOW)).toEqual({ activity: "ACTIVE", daysSince: 3 });
    expect(outletActivity(ago(90), NOW).activity).toBe("ACTIVE");
  });

  it("calls an outlet silent for longer dormant, and one silent for 180 days or more lost", () => {
    expect(outletActivity(ago(91), NOW)).toEqual({ activity: "LAPSED", daysSince: 91 });
    expect(outletActivity(ago(179), NOW).activity).toBe("LAPSED");
    expect(outletActivity(ago(180), NOW).activity).toBe("LOST");
    expect(outletActivity(ago(400), NOW).activity).toBe("LOST");
  });

  it("marks an outlet with no purchase on record", () => {
    expect(outletActivity(null, NOW)).toEqual({ activity: "NO_PURCHASE", daysSince: null });
  });

  it("puts the active cutoff 90 days back", () => {
    expect(activeCutoffDate(NOW).toISOString().slice(0, 10)).toBe("2026-07-28");
  });
});
