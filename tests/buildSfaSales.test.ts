import { describe, it, expect } from "vitest";
import { buildSfaSales } from "../scripts/db-bridge/transform/buildSfaSales";
import type { SfaSalesLine } from "../scripts/db-bridge/queries/sfaSalesLines";
import type { ProductRow } from "../scripts/db-bridge/reference/loadFromDb";
import type { WarehouseRow } from "../scripts/db-bridge/transform/buildMonthlySales";

const warehouses: WarehouseRow[] = [{ warehouseCode: "W1", warehouseName: "Main", location: "Nairobi", locationCode: "NBI" }];
const products: ProductRow[] = [
  { itemNo: "SUN00001", packSize: 12, principal: "Suntory", costPrice: null, classification: "", ssuConversion: null },
  { itemNo: "SUN00030", packSize: 12, principal: "Suntory", costPrice: null, classification: "", ssuConversion: null },
];

function line(over: Partial<SfaSalesLine>): SfaSalesLine {
  return {
    docType: "INVOICE",
    docNum: "1001",
    docDate: "2026-09-01",
    series: 92,
    cardCode: "C-41627",
    accountName: "Cash Customer- Risper",
    sfaName: "Carol Mpesa Shop (+254720045344)",
    numAtCard: "OI-172083",
    slpCode: 7,
    repName: "Risper Ondimu",
    itemCode: "SUN00001",
    itemName: "Lucozade NRG Boost",
    whsCode: "W1",
    isFreeSale: false,
    qty: 24,
    packSize: 12,
    salesAmount: 1000,
    grossMargin: 200,
    sapGrossProfit: 210,
    ...over,
  };
}

describe("buildSfaSales", () => {
  it("keys customers on the SFA outlet, not the shared billing account", () => {
    const { monthlyRows } = buildSfaSales(
      [
        line({}),
        line({ docNum: "1002", sfaName: "Benann Supermarket (+254719542572)", salesAmount: 500, grossMargin: 100 }),
      ],
      products,
      warehouses
    );
    expect(monthlyRows).toHaveLength(2);
    expect(monthlyRows.map((r) => r.sfaCustomer).sort()).toEqual(["Benann Supermarket", "Carol Mpesa Shop"]);
    expect(monthlyRows.every((r) => r.accountName === "Cash Customer- Risper")).toBe(true);
  });

  it("aggregates a document's lines and converts quantity to cases", () => {
    const { documents } = buildSfaSales(
      [line({}), line({ itemCode: "SUN00030", qty: 12, salesAmount: 300, grossMargin: 60, sapGrossProfit: 65 })],
      products,
      warehouses
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ lineCount: 2, netSales: 1300, grossProfit: 260, sapGrossProfit: 275, cases: 3, numAtCard: "OI-172083" });
  });

  it("falls back to the account name when SFA left the outlet blank", () => {
    const { documents } = buildSfaSales([line({ sfaName: null, accountName: "Junior Wholesaler" })], products, warehouses);
    expect(documents[0]).toMatchObject({ sfaCustomer: "Junior Wholesaler", sfaNameSource: "ACCOUNT" });
  });

  it("uses Product Master first and the prefix rules as a tagged fallback", () => {
    const { documents, stats } = buildSfaSales(
      [
        line({ docNum: "1", itemCode: "SUN00030", itemName: "Afripop Black currant" }), // mapped to Suntory in Product Master
        line({ docNum: "2", itemCode: "SUN00099", itemName: "Afripop Mango" }), // not in Product Master -> prefix rule -> Bidco
        line({ docNum: "3", itemCode: "SERV0001", itemName: "Delivery service" }),
      ],
      products,
      warehouses
    );
    const byDoc = new Map(documents.map((d) => [d.docNum, d]));
    expect(byDoc.get("1")).toMatchObject({ principal: "Suntory-Nairobi", principalSource: "PRODUCT" });
    expect(byDoc.get("2")).toMatchObject({ principal: "Bidco-Nairobi", principalSource: "PREFIX" });
    expect(byDoc.get("3")).toMatchObject({ principal: "Unallocated", principalSource: "UNALLOCATED" });
    expect(stats.unallocatedItems.map((i) => i.itemCode)).toEqual(["SERV0001"]);
  });

  it("keeps credit notes negative and separate from the invoice", () => {
    const { documents, monthlyRows } = buildSfaSales(
      [line({ docNum: "5", docType: "CREDIT_NOTE", qty: -12, salesAmount: -400, grossMargin: -80, sapGrossProfit: -85 }), line({ docNum: "5" })],
      products,
      warehouses
    );
    expect(documents).toHaveLength(2);
    expect(documents.find((d) => d.docType === "CREDIT_NOTE")?.netSales).toBe(-400);
    expect(monthlyRows[0].revenue).toBe(600);
    expect(monthlyRows[0].docCount).toBe(2);
  });

  it("splits one outlet's month by principal so principal totals reconcile", () => {
    const { monthlyRows } = buildSfaSales(
      [line({}), line({ itemCode: "SUN00099", itemName: "Afripop Mango", salesAmount: 250 })],
      products,
      warehouses
    );
    expect(monthlyRows.map((r) => r.principal).sort()).toEqual(["Bidco-Nairobi", "Suntory-Nairobi"]);
  });
});
