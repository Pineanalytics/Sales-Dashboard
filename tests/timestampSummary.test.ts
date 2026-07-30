import { describe, expect, it } from "vitest";
import { principalScopedSalesRole } from "@/lib/timestampSummary";

describe("principalScopedSalesRole", () => {
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
