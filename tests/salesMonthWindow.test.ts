import { describe, expect, it } from "vitest";
import { monthWindow } from "../scripts/db-bridge/transform/salesMonthWindow";

const now = new Date("2026-11-02T13:00:00Z");

describe("monthWindow", () => {
  it("covers a closed month from its first to its last day", () => {
    expect(monthWindow("2026-10", now)).toEqual({ year: 2026, monthIndex: 9, start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-31T00:00:00Z") });
    expect(monthWindow("2026-02", now)).toMatchObject({ end: new Date("2026-02-28T00:00:00Z") });
  });
  it("refuses the current month, a future month and a malformed value", () => {
    expect(monthWindow("2026-11", now)).toHaveProperty("error");
    expect(monthWindow("2027-01", now)).toHaveProperty("error");
    expect(monthWindow("2026-13", now)).toHaveProperty("error");
    expect(monthWindow("October", now)).toHaveProperty("error");
  });
});
