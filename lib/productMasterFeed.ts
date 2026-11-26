// The Product Master data feed (/api/feeds/product-master): SAP's item master as mirrored in SapItem, with the dashboard principal
// (Product Master principal, else the item-prefix rules) and the supplier of each item's last goods receipt. Server only; the
// row-to-CSV step is pure (productMasterCsv) so it can be tested without a database.
import type { SapItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PRODUCT_FEED_COLUMNS } from "@/lib/dataFeedScript";
import { csvCell } from "@/lib/outletUniverse/frequencyExport";
import { allocatePrincipal } from "@/lib/principalRules";

export interface LastReceipt {
  supplierCode: string;
  supplierName: string;
  docDate: Date;
}

export interface ProductMasterData {
  items: SapItem[];
  /** Product Master principal by item code. */
  principals: Map<string, string>;
  lastReceipts: Map<string, LastReceipt>;
  /** When SAP was last read (the newest SapItem.syncedAt), or null before the first sync. */
  syncedAt: Date | null;
}

const ymd = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "" : Number(v.toFixed(6)));
const yn = (v: boolean | null | undefined) => (v === true ? "Y" : v === false ? "N" : "");
const t = (v: string | null | undefined) => v ?? "";

type Cell = string | number;

function columnValue(column: string, item: SapItem, data: ProductMasterData): Cell {
  const receipt = data.lastReceipts.get(item.itemCode);
  switch (column) {
    case "Item Code": return item.itemCode;
    case "Item Name": return t(item.itemName);
    case "Foreign Name": return t(item.foreignName);
    case "Item Group Code": return n(item.itemGroupCode);
    case "Item Group": return t(item.itemGroup);
    case "Manufacturer Code": return n(item.manufacturerCode);
    case "Manufacturer": return t(item.manufacturer);
    case "Principal": return data.principals.get(item.itemCode) || allocatePrincipal(item.itemCode, item.itemName).principal;
    case "Inventory UOM": return t(item.inventoryUom);
    case "Sales UOM": return t(item.salesUom);
    case "Purchase UOM": return t(item.purchaseUom);
    case "Units Per Sales Unit": return n(item.unitsPerSalesUnit);
    case "Units Per Purchase Unit": return n(item.unitsPerPurchaseUnit);
    case "On Hand Qty": return n(item.onHand);
    case "Committed Qty": return n(item.committed);
    case "On Order Qty": return n(item.onOrder);
    case "Average Cost": return n(item.averageCost);
    case "Last Purchase Price": return n(item.lastPurchasePrice);
    case "Preferred Supplier Code": return t(item.preferredSupplierCode);
    case "Preferred Supplier": return t(item.preferredSupplier);
    case "Supplier Product Code": return t(item.supplierProductCode);
    case "Last Received Supplier Code": return receipt?.supplierCode ?? "";
    case "Last Received Supplier": return receipt?.supplierName ?? "";
    case "Last Received Date": return ymd(receipt?.docDate);
    case "Active": return yn(item.active);
    case "Frozen": return yn(item.frozen);
    case "Created Date": return ymd(item.sapCreatedAt);
    case "Last Updated Date": return ymd(item.sapUpdatedAt);
    case "Selling Price": return n(item.sellingPrice);
    case "Selling Currency": return t(item.sellingCurrency);
    case "Purchase Price": return n(item.purchasePrice);
    case "Purchase Currency": return t(item.purchaseCurrency);
    default: return "";
  }
}

/** The feed as CSV: the asked columns (PRODUCT_FEED_COLUMNS names, in the order given; unknown names are skipped), one row per item. */
export function productMasterCsv(data: ProductMasterData, columns: string[]): string {
  const chosen = columns.filter((column) => PRODUCT_FEED_COLUMNS.includes(column));
  const lines = [chosen.map(csvCell).join(",")];
  for (const item of data.items) lines.push(chosen.map((column) => csvCell(columnValue(column, item, data))).join(","));
  return lines.join("\r\n");
}

/** Goods receipts and AP invoices name the supplier an item really came from; the newest one per item wins. */
const RECEIPT_TYPES = ["GOODS_RECEIPT_PO", "AP_INVOICE"];

export async function loadProductMasterData(): Promise<ProductMasterData> {
  const [items, products, receipts] = await Promise.all([
    prisma.sapItem.findMany({ orderBy: { itemCode: "asc" } }),
    prisma.product.findMany({ select: { itemNo: true, principal: true } }),
    prisma.$queryRaw<{ itemCode: string; supplierCode: string; supplierName: string; docDate: Date }[]>`
      SELECT DISTINCT ON ("itemCode") "itemCode", "supplierCode", "supplierName", "docDate"
      FROM "PurchaseReceiptLine"
      WHERE "docType" IN (${RECEIPT_TYPES[0]}, ${RECEIPT_TYPES[1]}) AND "supplierCode" <> '(none)' AND "qty" > 0
      ORDER BY "itemCode", "docDate" DESC, "docEntry" DESC`,
  ]);
  const principals = new Map(products.filter((p) => p.principal?.trim()).map((p) => [p.itemNo, p.principal.trim()]));
  const lastReceipts = new Map(receipts.map((r) => [r.itemCode, { supplierCode: r.supplierCode, supplierName: r.supplierName, docDate: r.docDate }]));
  const syncedAt = items.reduce<Date | null>((latest, item) => (!latest || item.syncedAt > latest ? item.syncedAt : latest), null);
  return { items, principals, lastReceipts, syncedAt };
}
