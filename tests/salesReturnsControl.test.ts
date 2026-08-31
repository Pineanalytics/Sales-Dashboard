import { describe, expect, it } from "vitest";
import { isHistoricalSalesReturnsWindow, nairobiYesterdayStartUtc } from "../lib/salesReturnsControl";

describe("Sales & Returns branch control", () => {
  const now = new Date("2026-08-31T13:00:00.000Z"); // 4:00 PM Nairobi

  it("allows yesterday and today for the normal five-minute catchup", () => {
    expect(isHistoricalSalesReturnsWindow(new Date("2026-08-30T00:00:00.000Z"), now)).toBe(false);
    expect(isHistoricalSalesReturnsWindow(new Date("2026-08-31T00:00:00.000Z"), now)).toBe(false);
  });

  it("classifies older windows as historical backfill", () => {
    expect(isHistoricalSalesReturnsWindow(new Date("2026-08-29T00:00:00.000Z"), now)).toBe(true);
  });

  it("uses the Nairobi calendar day boundary", () => {
    expect(nairobiYesterdayStartUtc(new Date("2026-08-30T22:30:00.000Z")).toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });
});
