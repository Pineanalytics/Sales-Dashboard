// Turns SAP stock-ledger rows into the report's receipt lines: attributes each to a principal the way sales do (Product Master principal + warehouse location with the
// pipeline's fixups, item-prefix rules as the fallback) and converts pieces to cases with the Product Master pack size. Lines with no principal are kept as "Unallocated"
// and counted, never dropped, so the report always reconciles to SAP.
import { UNALLOCATED_PRINCIPAL } from "@/lib/principalRules";
import { isEmptiesWarehouse, SAP_TRANS_TYPE_TO_DOC, type PurchaseReceiptRow } from "@/lib/purchaseReceipts/types";
import type { PurchaseReceiptSapRow } from "../queries/purchaseReceipts";
import type { ProductRow } from "../reference/loadFromDb";
import type { WarehouseRow } from "./buildMonthlySales";
import { resolveLinePrincipal } from "./buildSfaSales";

export interface PurchaseBuildStats {
  sapRows: number;
  droppedRows: number;
  /** Net value by how the principal was found. */
  valueBySource: Record<"PRODUCT" | "PREFIX" | "UNALLOCATED", number>;
  unallocatedItems: { itemCode: string; itemName: string; value: number }[];
}

export interface PurchaseBuildResult {
  rows: PurchaseReceiptRow[];
  stats: PurchaseBuildStats;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function buildPurchaseReceipts(sapRows: PurchaseReceiptSapRow[], products: ProductRow[], warehouses: WarehouseRow[]): PurchaseBuildResult {
  const productByItemNo = new Map(products.map((p) => [p.itemNo, p]));
  const warehouseByCode = new Map(warehouses.map((w) => [w.warehouseCode, w]));
  const valueBySource: PurchaseBuildStats["valueBySource"] = { PRODUCT: 0, PREFIX: 0, UNALLOCATED: 0 };
  const unallocated = new Map<string, { itemCode: string; itemName: string; value: number }>();
  const rows: PurchaseReceiptRow[] = [];
  let dropped = 0;

  for (const row of sapRows) {
    const docType = SAP_TRANS_TYPE_TO_DOC[row.transType];
    // A document and its cancellation net to nothing: no quantity and no value is no receipt.
    if (!docType || (Math.abs(row.qty) < 1e-9 && Math.abs(row.value) < 0.005)) {
      dropped += 1;
      continue;
    }
    const resolved = resolveLinePrincipal({ itemCode: row.itemCode, itemName: row.itemName, whsCode: row.whsCode }, productByItemNo, warehouseByCode);
    const warehouse = warehouseByCode.get(row.whsCode);
    const packSize = productByItemNo.get(row.itemCode)?.packSize ?? null;
    valueBySource[resolved.source] += row.value;
    if (resolved.source === "UNALLOCATED") {
      const entry = unallocated.get(row.itemCode) ?? { itemCode: row.itemCode, itemName: row.itemName, value: 0 };
      entry.value += row.value;
      unallocated.set(row.itemCode, entry);
    }
    rows.push({
      docType,
      docEntry: row.docEntry,
      docNum: row.docNum,
      docDate: isoDate(row.docDate),
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      itemCode: row.itemCode,
      itemName: row.itemName,
      warehouseCode: row.whsCode,
      location: warehouse?.location ?? "Nairobi",
      principal: resolved.source === "UNALLOCATED" ? UNALLOCATED_PRINCIPAL : resolved.principal,
      principalSource: resolved.source,
      stockClass: isEmptiesWarehouse(warehouse?.warehouseName) ? "EMPTIES" : "GOODS",
      qty: row.qty,
      cases: packSize && packSize > 0 ? row.qty / packSize : 0,
      value: row.value,
    });
  }
  return {
    rows,
    stats: { sapRows: sapRows.length, droppedRows: dropped, valueBySource, unallocatedItems: [...unallocated.values()].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)) },
  };
}
