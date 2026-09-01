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
    expect(row.NetPrice).toBe("-5320.00");
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

  it("changes the manifest revision when report content changes", () => {
    expect(contentRevision("a")).not.toBe(contentRevision("b"));
    expect(contentRevision("a")).toBe(contentRevision("a"));
  });
});
