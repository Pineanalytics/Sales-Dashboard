import { describe, expect, it } from "vitest";
import { salesRole, monthLabel } from "../scripts/jp-adherence/import-plan";

describe("salesRole (Journey Plan import normalization)", () => {
  it("normalizes the workbook's short values to EmployeeMaster's convention", () => {
    expect(salesRole("Primary", 2)).toBe("Primary Sales");
    expect(salesRole("Secondary", 2)).toBe("Secondary Sales");
  });

  it("accepts the already-long form too", () => {
    expect(salesRole("Primary Sales", 2)).toBe("Primary Sales");
    expect(salesRole("Secondary Sales", 2)).toBe("Secondary Sales");
  });

  it("is case-insensitive", () => {
    expect(salesRole("PRIMARY", 2)).toBe("Primary Sales");
    expect(salesRole("secondary", 2)).toBe("Secondary Sales");
  });

  it("throws with the row number on an unrecognized value", () => {
    expect(() => salesRole("Tertiary", 5)).toThrow(/row 5/);
  });
});

describe("monthLabel", () => {
  it("formats a date as the established abbreviated convention", () => {
    expect(monthLabel(new Date(Date.UTC(2026, 6, 3)))).toBe("Jul-2026");
    expect(monthLabel(new Date(Date.UTC(2026, 7, 31)))).toBe("Aug-2026");
  });
});
