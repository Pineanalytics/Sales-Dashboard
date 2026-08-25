import { describe, expect, it } from "vitest";
import { validateUpfieldUploadBatch } from "@/lib/upfieldIngestion";

function record(overrides: Record<string, unknown> = {}) {
  return {
    sourceRecordId: "OI-0758-225026|21028400|OI-0758-225026",
    type: "sale",
    txnDate: "2026-08-22T07:12:42+03:00",
    invoiceNo: "OI-0758-225026",
    docNo: "OI-0758-225026",
    custCode: "277357",
    custName: "Maneno",
    itemCode: "21028400",
    itemDesc: "BBM Ori(500gx24)",
    itemPrice: 230.91,
    qty: 2,
    saleExcl: 461.82,
    disc: 0,
    vat: 73.89,
    saleIncl: 535.71,
    fsr: "Catherine Nduku",
    printedBy: "Makena Manager(makena.pinefrost)",
    sourceFile: "SalesRawData_24_08_2026_051023.xlsx",
    ...overrides,
  };
}

function batch(overrides: Record<string, unknown> = {}) {
  return {
    source: "upfield-dataedge",
    syncRunId: "b3d2e9b4-2f1a-4b8e-9c2e-2a6f1e0c9d11",
    windowStart: "2026-08-24T00:00:00+03:00",
    windowEnd: "2026-08-24T23:59:59+03:00",
    batchNumber: 1,
    isFinalBatch: true,
    recordCount: 1,
    records: [record()],
    ...overrides,
  };
}

describe("validateUpfieldUploadBatch", () => {
  it("accepts the scheduler contract without field changes", () => {
    expect(validateUpfieldUploadBatch(batch())).toMatchObject({ ok: true });
  });

  it("rejects a sourceRecordId that does not match its natural key", () => {
    const result = validateUpfieldUploadBatch(batch({ records: [record({ sourceRecordId: "wrong" })] }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("invoiceNo|itemCode|docNo");
  });

  it("rejects a recordCount mismatch", () => {
    expect(validateUpfieldUploadBatch(batch({ recordCount: 2 }))).toMatchObject({ ok: false });
  });

  it("allows negative return quantities and values", () => {
    const returned = record({ type: "return", qty: -24, saleExcl: -1200.72, vat: -190.2, saleIncl: -1384.92 });
    expect(validateUpfieldUploadBatch(batch({ records: [returned] }))).toMatchObject({ ok: true });
  });

  it("accepts an empty final batch for a zero-record day", () => {
    expect(validateUpfieldUploadBatch(batch({ records: [], recordCount: 0 }))).toMatchObject({ ok: true });
  });
});
