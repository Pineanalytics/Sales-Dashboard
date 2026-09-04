import { describe, expect, it } from "vitest";
import {
  createSalesReturnsExtractionSerial,
  isSalesReturnsExtractionSerial,
  isSalesReturnsExtractionStatus,
} from "../lib/salesReturnsExtraction";

describe("Sales & Returns extraction serials", () => {
  it("creates readable, unique serials for a branch and run time", () => {
    const now = new Date("2026-09-04T08:15:30.123Z");
    const first = createSalesReturnsExtractionSerial("18048241", now);
    const second = createSalesReturnsExtractionSerial("18048241", now);

    expect(first).toMatch(/^SR-18048241-20260904T081530123Z-[A-F0-9]{8}$/);
    expect(isSalesReturnsExtractionSerial(first)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("rejects malformed serials and statuses", () => {
    expect(isSalesReturnsExtractionSerial("18048241-2026-09-04")).toBe(false);
    expect(isSalesReturnsExtractionStatus("COMPLETED")).toBe(true);
    expect(isSalesReturnsExtractionStatus("SUCCESS")).toBe(false);
  });
});
