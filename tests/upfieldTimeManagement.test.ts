import { describe, expect, it } from "vitest";
import { upfieldClosingStatus, upfieldFirstTransactionStatus, upfieldMinutesAfterMidnight } from "@/lib/upfieldTimeManagement";

describe("Upfield time-management policy", () => {
  it("treats 08:00 as on time and 08:01 as needing attention", () => {
    expect(upfieldFirstTransactionStatus("2026-08-10T08:00:00.000Z")).toBe("on-time");
    expect(upfieldFirstTransactionStatus("2026-08-10T08:01:00.000Z")).toBe("late");
  });

  it("reads the Nairobi wall-clock shaped value without another timezone shift", () => {
    expect(upfieldMinutesAfterMidnight("2026-08-10T16:15:13.000Z")).toBe(16 * 60 + 15);
  });

  it("assesses a 4 PM close only after the day has elapsed", () => {
    const now = new Date("2026-08-26T12:00:00.000Z");
    expect(upfieldClosingStatus("2026-08-25", "2026-08-25T16:00:00.000Z", now)).toBe("closed-on-time");
    expect(upfieldClosingStatus("2026-08-25", "2026-08-25T15:59:00.000Z", now)).toBe("closed-early");
    expect(upfieldClosingStatus("2026-08-26", "2026-08-26T10:00:00.000Z", now)).toBe("day-in-progress");
  });
});
