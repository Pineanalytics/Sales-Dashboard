import { describe, expect, it } from "vitest";
import {
  selectOldestMismatch,
  signaturesMatch,
  type SalesReturnsDailySignature,
} from "../lib/salesReturnsReconciliation";

function signature(date: string, rowCount = 10, netSale = 100): SalesReturnsDailySignature {
  return {
    date,
    rowCount,
    invoiceCount: rowCount,
    saleQtyPieces: rowCount,
    freeQtyPieces: 0,
    grossSale: netSale,
    netSale,
    totalDiscount: 0,
  };
}

describe("Sales & Returns smart reconciliation", () => {
  it("does nothing when the VPS matches SQL within numeric storage tolerance", () => {
    expect(signaturesMatch(signature("2026-08-30"), { ...signature("2026-08-30"), netSale: 100.009 })).toBe(true);
    expect(selectOldestMismatch([signature("2026-08-30")], [signature("2026-08-30")])).toBeNull();
  });

  it("repairs the oldest missing or changed day before the latest day", () => {
    const selected = selectOldestMismatch(
      [signature("2026-08-28", 8), signature("2026-08-29", 9), signature("2026-08-30", 10)],
      [signature("2026-08-29", 7), signature("2026-08-30", 9)]
    );
    expect(selected?.date).toBe("2026-08-28");
  });

  it("selects a VPS-only day so a source deletion can remove stale target rows", () => {
    const selected = selectOldestMismatch([], [signature("2026-08-27")]);
    expect(selected?.date).toBe("2026-08-27");
    expect(selected?.source.rowCount).toBe(0);
  });

  it("detects value reconciliation even when row and invoice counts do not change", () => {
    const selected = selectOldestMismatch([signature("2026-08-30", 10, 120)], [signature("2026-08-30", 10, 100)]);
    expect(selected?.date).toBe("2026-08-30");
  });
});
