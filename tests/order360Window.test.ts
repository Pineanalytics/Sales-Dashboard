import { describe, expect, it } from "vitest";
import { planOrderSyncWindow } from "../scripts/db-bridge/order-360/window";

const at = (iso: string) => new Date(iso);

describe("planOrderSyncWindow", () => {
  it("does a full three-month pass when none is on record", () => {
    const plan = planOrderSyncWindow(at("2026-10-12T10:00:00Z"), null, false);
    expect(plan.mode).toBe("full");
    expect(plan.windowStart.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("does a full pass when the last one is over 22 hours old, so one runs about once a day", () => {
    expect(planOrderSyncWindow(at("2026-10-12T10:00:00Z"), "2026-10-11T11:00:00Z", false).mode).toBe("full"); // 23h
    expect(planOrderSyncWindow(at("2026-10-12T10:00:00Z"), "2026-10-11T13:00:00Z", false).mode).toBe("rolling"); // 21h
  });

  it("treats an unreadable full-pass timestamp as missing", () => {
    expect(planOrderSyncWindow(at("2026-10-12T10:00:00Z"), "not a date", false).mode).toBe("full");
  });

  it("forces a full pass on request even when one is recent", () => {
    expect(planOrderSyncWindow(at("2026-10-12T10:00:00Z"), "2026-10-12T09:00:00Z", true).mode).toBe("full");
  });

  it("refreshes the whole current month on a rolling run, not just today", () => {
    const plan = planOrderSyncWindow(at("2026-10-28T10:00:00Z"), "2026-10-28T02:00:00Z", false);
    expect(plan.mode).toBe("rolling");
    // 21 days back is 7 Oct; the start of the month (1 Oct) is earlier, so the whole month is re-read
    expect(plan.windowStart.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("reaches back into the previous month early in a month, for deliveries still to come on its last orders", () => {
    const plan = planOrderSyncWindow(at("2026-10-03T10:00:00Z"), "2026-10-03T02:00:00Z", false);
    expect(plan.mode).toBe("rolling");
    expect(plan.windowStart.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });

  it("handles the year boundary", () => {
    expect(planOrderSyncWindow(at("2027-01-05T10:00:00Z"), null, false).windowStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(planOrderSyncWindow(at("2027-01-05T10:00:00Z"), "2027-01-05T02:00:00Z", false).windowStart.toISOString()).toBe("2026-12-15T00:00:00.000Z");
  });
});
