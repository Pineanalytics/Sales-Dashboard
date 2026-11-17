import { describe, expect, it } from "vitest";
import type { SapItem } from "@prisma/client";
import { parseFeedColumns, powerQueryScript, PRODUCT_FEED_COLUMNS, PRODUCT_MASTER_FEED, PRODUCT_SUPPLIER_COLUMNS, PRODUCT_SUPPLIER_PREFIXES } from "@/lib/dataFeedScript";
import { productMasterCsv, type ProductMasterData } from "@/lib/productMasterFeed";
import { buildSapItems, type SapItemMasterRow } from "@/lib/sapItemMaster";

const sapRow = (over: Partial<SapItemMasterRow>): SapItemMasterRow => ({
  ItemCode: "MARS001", ItemName: "Snickers 50g", FrgnName: null, ItmsGrpCod: 101, ItmsGrpNam: "Confectionery", FirmCode: 3, FirmName: "-Select Manufacturer-",
  InvntryUom: "PCS", SalUnitMsr: "CTN", BuyUnitMsr: "CTN", NumInSale: 24, NumInBuy: 24, OnHand: 120, IsCommited: 10, OnOrder: 0, AvgPrice: 55.123456789,
  LastPurPrc: 56, CardCode: "  ", CardName: null, ValidFor: "Y", FrozenFor: "N", CreateDate: new Date("2025-03-04T00:00:00Z"), UpdateDate: null,
  SellingPrice: 70, SellingCurrency: "KES", PurchasePrice: null, PurchaseCurrency: null, ...over,
});

describe("the SAP item master mirror", () => {
  it("trims text, reads Y/N flags and keeps one record per item", () => {
    const at = new Date("2026-11-17T08:00:00Z");
    const items = buildSapItems([sapRow({}), sapRow({ ItemName: "dup" }), sapRow({ ItemCode: " ", ItemName: "no code" }), sapRow({ ItemCode: "UKL9", CardCode: " S-0141 ", ValidFor: "N", FrozenFor: "Y" })], at);
    expect(items.map((i) => i.itemCode)).toEqual(["MARS001", "UKL9"]);
    expect(items[0]).toMatchObject({ itemName: "Snickers 50g", preferredSupplierCode: null, active: true, frozen: false, syncedAt: at });
    expect(items[1]).toMatchObject({ preferredSupplierCode: "S-0141", active: false, frozen: true });
  });
});

describe("the Product Master feed", () => {
  it("defaults to served columns plus the three the script makes", () => {
    for (const column of PRODUCT_MASTER_FEED.defaultColumns) {
      expect([...PRODUCT_FEED_COLUMNS, ...PRODUCT_SUPPLIER_COLUMNS]).toContain(column);
    }
    expect(parseFeedColumns("Item Code|Supplier Code|Principal", PRODUCT_FEED_COLUMNS, ["Item Code"])).toEqual(["Item Code", "Principal"]);
  });

  it("writes CSV with the dashboard principal, the last receipt, dates and Y/N", () => {
    const [mars, hcm] = buildSapItems([sapRow({}), sapRow({ ItemCode: "HCM12", ItemName: "Bleach 1L", AvgPrice: null })], new Date()) as unknown as SapItem[];
    const data: ProductMasterData = {
      items: [mars, hcm],
      principals: new Map([["MARS001", "Mars"]]),
      lastReceipts: new Map([["HCM12", { supplierCode: "S-0230", supplierName: "Highchem Ltd", docDate: new Date("2026-11-02T00:00:00Z") }]]),
      syncedAt: null,
    };
    const csv = productMasterCsv(data, ["Item Code", "Principal", "Manufacturer", "Average Cost", "Last Received Supplier Code", "Last Received Date", "Active", "Created Date", "Supplier Code"]);
    expect(csv.split("\r\n")).toEqual([
      "Item Code,Principal,Manufacturer,Average Cost,Last Received Supplier Code,Last Received Date,Active,Created Date",
      "MARS001,Mars,'-Select Manufacturer-,55.123457,,,Y,2025-03-04",
      "HCM12,Highchem,'-Select Manufacturer-,,S-0230,2026-11-02,Y,2025-03-04",
    ]);
  });

  it("writes a script with no period, the supplier inputs requested and the prefix list embedded", () => {
    const script = powerQueryScript({ baseUrl: "https://pinefrostdb.com", feed: PRODUCT_MASTER_FEED, key: "pfk_abc" });
    expect(script).not.toContain("Period");
    expect(script).toContain('RelativePath = "api/feeds/product-master",');
    expect(script).toContain('Query = [columns = Text.Combine(Requested, "|")],');
    expect(script).toContain('Requested = List.Distinct(List.RemoveItems(Columns, {"Supplier Code", "Supplier", "Supplier Code Source"}) & {"Item Code", "Preferred Supplier Code"');
    expect(script).toContain('{"UP", "S-0046", "Upfield"}');
    expect(script).toContain('{"HCM", "S-0230", "Highchem"}');
    for (const row of ['{"TR", "S-0229", "Trade Roots"}', '{"WEET", "S-0099", "Weetabix"}', '{"MEGA", "S-0079", "Mega Wholesalers"}', '{"UDV", "S-0074", "UDV (Kenya)"}']) expect(script).toContain(row);
    expect(script.match(/\{"[A-Z]+", "S-\d{4}", "[^"]+"\}/g)).toHaveLength(PRODUCT_SUPPLIER_PREFIXES.length);
    expect(script).toContain("Selected = Table.SelectColumns(Suppliers, Columns, MissingField.UseNull),");
    expect(script).toContain("Renamed = Table.RenameColumns(Selected, Renames, MissingField.Ignore),");
    expect(script).toContain('Blanks = Table.ReplaceValue(Renamed, "", null, Replacer.ReplaceValue, {"Item Group Code", "Manufacturer Code",');
    expect(script).toContain("Typed = Table.TransformColumnTypes(Blanks, {");
    expect(script).toContain('{"Created Date", type date}');
    expect(script).toContain('{"On Hand Qty", type number}');
    expect(script).toContain('{"Supplier Code", type text}');
  });

  it("lists every prefix once", () => {
    const prefixes = PRODUCT_SUPPLIER_PREFIXES.map((p) => p.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
