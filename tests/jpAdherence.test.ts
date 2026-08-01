import { describe, expect, it } from "vitest";
import { monthWindow, statusFor, dayNameFromDate } from "@/lib/jpAdherence";

describe("monthWindow", () => {
  it("returns the correct [start, end) UTC bounds for a mid-year month", () => {
    const { start, end } = monthWindow("2026", 6); // July (0-indexed)
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rolls over correctly for December", () => {
    const { start, end } = monthWindow("2026", 11);
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("statusFor", () => {
  it("classifies Excellent at 90% and above", () => {
    expect(statusFor(90)).toBe("Excellent");
    expect(statusFor(100)).toBe("Excellent");
  });

  it("classifies Good between 75% and just under 90%", () => {
    expect(statusFor(75)).toBe("Good");
    expect(statusFor(89.9)).toBe("Good");
  });

  it("classifies Below Target under 75%", () => {
    expect(statusFor(74.9)).toBe("Below Target");
    expect(statusFor(0)).toBe("Below Target");
  });
});

describe("dayNameFromDate", () => {
  it("matches the workbook's own English day names, keyed off UTC day-of-week", () => {
    // 2026-08-03 is a Monday (matches the real Journey Plan workbook's own first data row).
    expect(dayNameFromDate(new Date("2026-08-03T00:00:00.000Z"))).toBe("Monday");
    expect(dayNameFromDate(new Date("2026-08-02T00:00:00.000Z"))).toBe("Sunday");
    expect(dayNameFromDate(new Date("2026-08-08T00:00:00.000Z"))).toBe("Saturday");
  });
});
