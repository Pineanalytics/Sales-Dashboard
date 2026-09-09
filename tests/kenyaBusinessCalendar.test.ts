import { describe, expect, it } from "vitest";
import { isKenyaWorkingDay, kenyaPublicHolidayKeys, kenyaPublicHolidaysInRange } from "@/lib/kenyaBusinessCalendar";

describe("Kenyan dashboard working-day calendar", () => {
  it("excludes Saturday and Sunday while retaining an ordinary weekday", () => {
    expect(isKenyaWorkingDay("2026-09-11")).toBe(true);
    expect(isKenyaWorkingDay("2026-09-12")).toBe(false);
    expect(isKenyaWorkingDay("2026-09-13")).toBe(false);
  });

  it("excludes fixed, Easter-based, and confirmed movable national holidays", () => {
    expect(isKenyaWorkingDay("2026-01-01")).toBe(false);
    expect(isKenyaWorkingDay("2026-04-03")).toBe(false); // Good Friday
    expect(isKenyaWorkingDay("2026-04-06")).toBe(false); // Easter Monday
    expect(isKenyaWorkingDay("2026-03-20")).toBe(false); // Idd-ul-Fitr
    expect(isKenyaWorkingDay("2026-05-27")).toBe(false); // Idd-ul-Azha
  });

  it("observes a Sunday Part I holiday on the next non-holiday weekday", () => {
    // Madaraka Day fell on Sunday 1 June 2025, so Monday 2 June was observed.
    expect(kenyaPublicHolidayKeys(2025)).toContain("2025-06-02");
    expect(isKenyaWorkingDay("2025-06-02")).toBe(false);
  });

  it("returns only holidays inside the dashboard query window", () => {
    expect(kenyaPublicHolidaysInRange(new Date("2026-03-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z"))).toEqual(["2026-03-20"]);
  });
});
