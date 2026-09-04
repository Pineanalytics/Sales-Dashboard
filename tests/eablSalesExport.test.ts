import { describe, expect, it } from "vitest";
import { contentRevision, eablFilename, normaliseRow, parseIsoDate, toHeaderlessCsv } from "@/lib/eablSalesExport";

describe("EABL sales export formatting", () => {
  it("rejects malformed and impossible dates", () => {
    expect(parseIsoDate("2026-02-29")).toBeNull();
    expect(parseIsoDate("2026-08-20")).toBe("2026-08-20");
    expect(parseIsoDate("20/08/2026")).toBeNull();
  });

  it("implements the exact business transformations without grouped numerics", () => {
    expect(normaliseRow({ ProductCode: "B350360", TransactionDate: new Date("2026-08-20T00:00:00Z"), ExportDate: new Date("2026-08-21T00:00:00Z"), UnitPrice: 760, NetPrice: -5320, DiscountAmount: 0, DiscountPercent: 1.5 }).ProductCode).toBe("350360");
    const row = normaliseRow({ ProductCode: "B350360", TransactionDate: new Date("2026-08-20T00:00:00Z"), ExportDate: new Date("2026-08-21T00:00:00Z"), UnitPrice: 760, NetPrice: -5320, DiscountAmount: 0, DiscountPercent: 1.5 });
    expect(row.TransactionDate).toBe("20260820");
    expect(row.ExportDate).toBe("20260821");
    expect(row.UnitPrice).toBe("760");
    // -5320 VAT-inclusive / 1.16 = -4586.21 VAT-exclusive (see the dedicated
    // VAT-exclusion test below for the isolated calculation).
    expect(row.NetPrice).toBe("-4586.21");
    expect(row.DiscountAmount).toBe("0.00");
    expect(row.DiscountPercent).toBe("1.50%");
  });

  it("produces a UTF-8-compatible, headerless 22-column CSV with escaping", () => {
    const csv = toHeaderlessCsv([{ CustomerName: 'U&Me, "Nyahururu"', ProductCode: "B1", TransactionDate: "2026-08-20", UnitPrice: 1, NetPrice: 1, DiscountAmount: 0, DiscountPercent: 0 }]);
    expect(csv.split("\r\n")).toHaveLength(1);
    expect(csv).toContain('"U&Me, ""Nyahururu"""');
    expect(toHeaderlessCsv([{ ProductCode: "B1" }]).split(",")).toHaveLength(22);
    expect(eablFilename("2026-08-20")).toBe("EABL_20260820.csv");
  });

  it("corrects known upstream product-code exceptions after stripping the B prefix", () => {
    expect(normaliseRow({ ProductCode: "B696894" }).ProductCode).toBe("616838");
    // Confirms the exception is scoped to the exact known-bad code, not a
    // broad rule - an unrelated code isn't affected.
    expect(normaliseRow({ ProductCode: "B696895" }).ProductCode).toBe("696895");
  });

  it("exports NetPrice VAT-exclusive at the flat Kenyan 16% rate", () => {
    // 116 VAT-inclusive = 100 exclusive + 16 VAT, so dividing by 1.16 exactly
    // recovers a round number - the cleanest possible check of the formula.
    expect(normaliseRow({ NetPrice: 116 }).NetPrice).toBe("100.00");
    expect(normaliseRow({ NetPrice: 0 }).NetPrice).toBe("0.00");
    expect(normaliseRow({ NetPrice: null }).NetPrice).toBe("");
    // Applied uniformly regardless of Tax - there's no reliable per-row
    // taxed/exempt indicator in the source to condition it on (confirmed
    // 2026-09-04), so Tax itself is passed through unchanged either way.
    expect(normaliseRow({ NetPrice: 116, Tax: 0 }).NetPrice).toBe("100.00");
  });

  it("changes the manifest revision when report content changes", () => {
    expect(contentRevision("a")).not.toBe(contentRevision("b"));
    expect(contentRevision("a")).toBe(contentRevision("a"));
  });
});
