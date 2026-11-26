import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

// The pure report only needs the feed's types; the query module pulls in the database.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { buildRepSales, monthBefore } from "@/lib/coachingRepSales";
import { buildRepSalesWorkbook } from "@/lib/coachingRepSalesExcel";
import type { UniverseFeedRow, UniverseHistoryRow } from "@/lib/universeFeed";

const row = (over: Partial<UniverseFeedRow>): UniverseFeedRow =>
  ({
    sourceCode: "PINE", outletId: "1", outlet: "Shop", principal: "Mars-Nairobi", rep: "Van One", repSfaId: "562", teamLeader: "Jane Doe",
    status: "Active", tier: "Gold", territory: "Thika", territoryClean: "Thika", lastPurchase: "2026-11-02", daysSincePurchase: 24, salesYtd: 100,
    ...over,
  }) as UniverseFeedRow;
const history = (outletId: string, months: UniverseHistoryRow["months"], over: Partial<UniverseHistoryRow> = {}): UniverseHistoryRow =>
  ({ source: "Pine", sourceCode: "PINE", outletId, principal: "Mars-Nairobi", months, ...over });
const month = (sales: number, calls: number, productive: number | null, transactions = 0) => ({ sales, calls, productive, transactions });

const universe = [
  row({ outletId: "1" }),
  row({ outletId: "2" }),
  row({ outletId: "3", status: "Dormant" }),
  row({ outletId: "4", rep: "Van Two", repSfaId: "571", teamLeader: "John Roe" }),
  row({ outletId: "5", repSfaId: null }),
];
const months = [
  history("1", { "2026-11": month(500, 2, 1, 1), "2026-10": month(200, 1, 1, 1) }),
  history("2", { "2026-11": month(0, 2, 0) }),
  history("4", { "2026-11": month(50, 1, 1, 1) }),
];

describe("rep sales", () => {
  const report = buildRepSales(universe, months, { month: "2026-11", leaders: null });

  it("sorts each outlet into bought, visited without a sale, or not visited", () => {
    expect(report.outlets.filter((o) => o.repCode === "562").map((o) => [o.outletId, o.visit]).sort()).toEqual([
      ["1", "Bought"], ["2", "Visited, no sale"], ["3", "Not visited"],
    ]);
  });

  it("totals a rep the way the app does and leaves out outlets with no rep", () => {
    expect(report.reps.find((r) => r.repCode === "562")).toMatchObject({
      outlets: 3, buyingOutlets: 2, boughtThisMonth: 1, salesThisMonth: 500, salesLastMonth: 200, transactions: 1,
      outletsVisited: 2, visitedNoSale: 1, notVisited: 1, calls: 4, productiveCalls: 1, strikeRatePct: 25,
    });
    expect(report.outlets.some((o) => o.outletId === "5")).toBe(false);
  });

  it("shows no strike rate where productive calls are not recorded", () => {
    const leverage = buildRepSales(
      [row({ sourceCode: "LEVERAGE", principal: "Unilever-Nyeri" })],
      [history("1", { "2026-11": month(10, 3, null) }, { sourceCode: "LEVERAGE", principal: "Unilever-Nyeri" })],
      { month: "2026-11", leaders: null },
    );
    expect(leverage.reps[0]).toMatchObject({ calls: 3, productiveCalls: null, strikeRatePct: null });
  });

  it("limits a viewer to their team leaders, including the filter lists", () => {
    const mine = buildRepSales(universe, months, { month: "2026-11", leaders: ["john  roe"] });
    expect(mine.reps.map((r) => r.repCode)).toEqual(["571"]);
    expect(mine.teamLeaders).toEqual(["John Roe"]);
    expect(buildRepSales(universe, months, { month: "2026-11", leaders: [] }).reps).toEqual([]);
    expect(buildRepSales(universe, months, { month: "2026-11", leaders: ["John Roe"], teamLeader: "Jane Doe" }).reps).toEqual([]);
  });

  it("filters by rep and search", () => {
    expect(buildRepSales(universe, months, { month: "2026-11", leaders: null, search: "van two" }).reps.map((r) => r.repCode)).toEqual(["571"]);
    expect(buildRepSales(universe, months, { month: "2026-11", leaders: null, repCode: "562" }).outlets).toHaveLength(3);
  });

  it("counts months back across a year", () => {
    expect(monthBefore("2026-01", 1)).toBe("2025-12");
    expect(monthBefore("2026-11", 2)).toBe("2026-09");
  });

  it("writes one sheet per extract, a row per rep or per outlet", async () => {
    for (const [download, name, rows] of [["summary", "Rep sales", 2], ["outlets", "Outlet detail", 4]] as const) {
      const book = new ExcelJS.Workbook();
      const buffer = await buildRepSalesWorkbook(report, download);
      await book.xlsx.load(buffer as unknown as Parameters<typeof book.xlsx.load>[0]);
      expect(book.worksheets.map((s) => s.name)).toEqual([name]);
      expect(book.worksheets[0].actualRowCount).toBe(rows + 1);
      expect(book.worksheets[0].getRow(1).getCell(1).value).toBe("Team leader");
    }
  });
});
