import { describe, expect, it } from "vitest";
import { replacementPeriodsFromDailyWindows } from "../lib/salesReplacement";

describe("Brand & Customer replacement periods", () => {
  it("replaces the whole month, including dates that no longer have any SAP rows", () => {
    expect(replacementPeriodsFromDailyWindows([
      { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-08-20T00:00:00Z") },
    ])).toEqual([{ year: "2026", monthIndex: 7 }]);
  });

  it("covers every month in an explicit comparison window", () => {
    expect(replacementPeriodsFromDailyWindows([
      { start: new Date("2026-07-30T00:00:00Z"), end: new Date("2026-08-02T00:00:00Z") },
    ])).toEqual([
      { year: "2026", monthIndex: 6 },
      { year: "2026", monthIndex: 7 },
    ]);
  });
});
