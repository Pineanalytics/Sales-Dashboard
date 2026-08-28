import { describe, expect, it } from "vitest";
import { validateUpfieldUploadBatch, validateUpfieldVisitUploadBatch } from "@/lib/upfieldIngestion";

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

  // Confirmed live (2026-08-22/24/25 data): the same invoiceNo|itemCode|docNo
  // can legitimately appear twice - a zero-priced/free unit alongside the
  // real priced line. The 2nd+ occurrence carries a |N suffix.
  it("accepts a |N-suffixed sourceRecordId for a repeated invoice/item/doc line", () => {
    const freeLine = record({ sourceRecordId: "OI-0758-225026|21028400|OI-0758-225026", itemPrice: 0, qty: 1, saleExcl: 0 });
    const pricedLine = record({ sourceRecordId: "OI-0758-225026|21028400|OI-0758-225026|2" });
    const result = validateUpfieldUploadBatch(batch({ records: [freeLine, pricedLine], recordCount: 2 }));
    expect(result).toMatchObject({ ok: true });
  });

  it("still rejects a sourceRecordId with a non-numeric or |1 suffix", () => {
    const bad = record({ sourceRecordId: "OI-0758-225026|21028400|OI-0758-225026|abc" });
    const result = validateUpfieldUploadBatch(batch({ records: [bad] }));
    expect(result).toMatchObject({ ok: false });

    const badOne = record({ sourceRecordId: "OI-0758-225026|21028400|OI-0758-225026|1" });
    expect(validateUpfieldUploadBatch(batch({ records: [badOne] }))).toMatchObject({ ok: false });
  });
});

describe("validateUpfieldVisitUploadBatch", () => {
  function visitRecord(overrides: Record<string, unknown> = {}) {
    return {
      sourceRecordId: "Adrian Omondi|Greenspoon  Limited|2026-08-26T11:20:47.000+03:00",
      fsr: "Adrian Omondi",
      distributor: "PINEFROST LIMITED",
      pop: "Greenspoon  Limited",
      startTime: "2026-08-26T11:20:47.000+03:00",
      endTime: "2026-08-26T11:25:08.000+03:00",
      timeInOutlet: "00:04:21",
      transitTime: null,
      lppc: 1,
      sale: 9005.6,
      sourceFile: "Timestamp_Detail_2026-08-26_to_2026-08-26.xlsx",
      ...overrides,
    };
  }

  function visitBatch(overrides: Record<string, unknown> = {}) {
    return {
      source: "upfield-visits",
      syncRunId: "b3d2e9b4-2f1a-4b8e-9c2e-2a6f1e0c9d11",
      windowStart: "2026-08-26T00:00:00+03:00",
      windowEnd: "2026-08-26T23:59:59+03:00",
      batchNumber: 1,
      isFinalBatch: true,
      recordCount: 1,
      records: [visitRecord()],
      ...overrides,
    };
  }

  it("accepts the scheduler contract without field changes", () => {
    expect(validateUpfieldVisitUploadBatch(visitBatch())).toMatchObject({ ok: true });
  });

  it("rejects a sourceRecordId that does not match fsr|pop|startTime", () => {
    const result = validateUpfieldVisitUploadBatch(visitBatch({ records: [visitRecord({ sourceRecordId: "wrong" })] }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain("fsr|pop|startTime");
  });

  it("accepts a null endTime (visit still in progress)", () => {
    const inProgress = visitRecord({ endTime: null });
    expect(validateUpfieldVisitUploadBatch(visitBatch({ records: [inProgress] }))).toMatchObject({ ok: true });
  });

  it("accepts a |N-suffixed sourceRecordId for a repeated visit key", () => {
    const second = visitRecord({ sourceRecordId: "Adrian Omondi|Greenspoon  Limited|2026-08-26T11:20:47.000+03:00|2" });
    const result = validateUpfieldVisitUploadBatch(visitBatch({ records: [visitRecord(), second], recordCount: 2 }));
    expect(result).toMatchObject({ ok: true });
  });

  it("rejects records exceeding UPFIELD_MAX_BATCH_SIZE, same as the sales batch", () => {
    const records = Array.from({ length: 2001 }, () => visitRecord());
    expect(validateUpfieldVisitUploadBatch(visitBatch({ records, recordCount: 2001 }))).toMatchObject({ ok: false });
  });
});
