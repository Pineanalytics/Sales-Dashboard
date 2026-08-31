import { describe, expect, it, vi } from "vitest";

import { fetchSalesReturnDailySignatures } from "../scripts/db-bridge/sales-returns/query";

describe("Sales & Returns SQL compatibility", () => {
  it("does not use SQL Server's reserved ROWCOUNT keyword as an alias", async () => {
    const request = {
      input: vi.fn().mockReturnThis(),
      query: vi.fn().mockResolvedValue({ recordset: [] }),
    };
    const pool = { request: vi.fn(() => request) };

    await fetchSalesReturnDailySignatures(
      pool as never,
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-31T00:00:00.000Z"),
      "18058585"
    );

    const sqlText = request.query.mock.calls[0]?.[0] as string;
    expect(sqlText).toContain("COUNT(*) AS SignatureRowCount");
    expect(sqlText).not.toMatch(/\bAS\s+RowCount\b/i);
  });
});
