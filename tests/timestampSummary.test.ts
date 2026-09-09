import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { kenyaWorkingDayClause, principalScopedSalesRole, timestampPrincipalKey } from "@/lib/timestampSummary";

describe("principalScopedSalesRole", () => {
  it("uses the same normalized key as the global principal selector", () => {
    expect(timestampPrincipalKey("Mars-Nairobi")).toBe("mars");
    expect(timestampPrincipalKey("Bic-Nairobi")).toBe("bic");
    expect(timestampPrincipalKey("Weetabix-Nairobi")).toBe("weetabix");
  });

  it("keeps a TDR in Secondary for a Mars-selected rep-day, including no-sale calls", () => {
    expect(principalScopedSalesRole("TDR", "1155", "Mars-Nairobi", "Primary Sales")).toBe("Secondary Sales");
    expect(principalScopedSalesRole("TDR", "1155", "Mars-Nairobi", "Secondary Sales")).toBe("Secondary Sales");
  });

  it("keeps the two excluded DSR codes in Secondary for every selected principal", () => {
    expect(principalScopedSalesRole("DSR", "1172", "Bic-Nairobi", "Primary Sales")).toBe("Secondary Sales");
    expect(principalScopedSalesRole("DSR", "1032", "Mars-Nairobi", "Primary Sales")).toBe("Secondary Sales");
  });

  it("keeps qualifying DSR, TDR, KAMS, and Admin reps in Primary outside the Mars exception", () => {
    expect(principalScopedSalesRole("DSR", "575", "Mars-Nairobi", "Primary Sales")).toBe("Primary Sales");
    expect(principalScopedSalesRole("TDR", "1155", "Bic-Nairobi", "Secondary Sales")).toBe("Primary Sales");
    expect(principalScopedSalesRole("KAMS", "44", "Bic-Nairobi", "Secondary Sales")).toBe("Primary Sales");
    expect(principalScopedSalesRole("Admin", "45", "Bic-Nairobi", "Secondary Sales")).toBe("Primary Sales");
  });

  it("keeps MBSR in Secondary and preserves the stored role when no principal is selected", () => {
    expect(principalScopedSalesRole("MBSR", "99", "Mars-Nairobi", "Primary Sales")).toBe("Secondary Sales");
    expect(principalScopedSalesRole("TDR", "1155", null, "Primary Sales")).toBe("Primary Sales");
  });
});

describe("kenyaWorkingDayClause", () => {
  it("does not emit an invalid empty NOT IN list for a holiday-free month", () => {
    const clause = kenyaWorkingDayClause(
      Prisma.sql`r.date::date`,
      { start: new Date("2026-09-01T00:00:00.000Z"), end: new Date("2026-10-01T00:00:00.000Z") }
    );

    expect(clause.strings.join(" ")).toContain("EXTRACT(ISODOW");
    expect(clause.strings.join(" ")).not.toContain("NOT IN");
  });

  it("excludes configured public holidays when the month has one", () => {
    const clause = kenyaWorkingDayClause(
      Prisma.sql`r.date::date`,
      { start: new Date("2026-03-01T00:00:00.000Z"), end: new Date("2026-04-01T00:00:00.000Z") }
    );

    expect(clause.strings.join(" ")).toContain("NOT IN");
    expect(clause.values).toContain("2026-03-20");
  });
});
