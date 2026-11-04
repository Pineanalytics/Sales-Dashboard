// Shared shapes of the purchase / stock-receipt report. Pure: safe to import from the browser and from the SAP bridge.

/** The SAP documents that move stock in from, or back to, a supplier. */
export const RECEIPT_DOC_TYPES = ["GOODS_RECEIPT_PO", "GOODS_RETURN", "AP_INVOICE", "AP_CREDIT", "GOODS_RECEIPT_MANUAL", "LANDED_COST"] as const;
export type ReceiptDocType = (typeof RECEIPT_DOC_TYPES)[number];

/** OINM.TransType of each document type. */
export const SAP_TRANS_TYPE_TO_DOC: Record<number, ReceiptDocType> = {
  20: "GOODS_RECEIPT_PO",
  21: "GOODS_RETURN",
  18: "AP_INVOICE",
  19: "AP_CREDIT",
  59: "GOODS_RECEIPT_MANUAL",
  69: "LANDED_COST",
};
export const SAP_TRANS_TYPES = Object.keys(SAP_TRANS_TYPE_TO_DOC).map(Number);

export const DOC_TYPE_LABELS: Record<ReceiptDocType, string> = {
  GOODS_RECEIPT_PO: "Goods receipt (PO)",
  GOODS_RETURN: "Goods return to supplier",
  AP_INVOICE: "AP invoice (direct stock / price variance)",
  AP_CREDIT: "AP credit memo",
  GOODS_RECEIPT_MANUAL: "Goods receipt (manual)",
  LANDED_COST: "Landed costs",
};

/** What the headline shows: receipts from suppliers, returns and credits back to them, and the smaller adjustments. */
export type ReceiptGroup = "RECEIPT" | "RETURN" | "OTHER";
export const DOC_TYPE_GROUP: Record<ReceiptDocType, ReceiptGroup> = {
  GOODS_RECEIPT_PO: "RECEIPT",
  GOODS_RETURN: "RETURN",
  AP_CREDIT: "RETURN",
  AP_INVOICE: "OTHER",
  GOODS_RECEIPT_MANUAL: "OTHER",
  LANDED_COST: "OTHER",
};
export const GROUP_LABELS: Record<ReceiptGroup, string> = { RECEIPT: "Receipts", RETURN: "Returns & credits", OTHER: "Other adjustments" };

/** Returnable packaging (crates, bottles) is held in its own warehouses; the report keeps it apart from saleable goods. */
export type StockClass = "GOODS" | "EMPTIES";
export const isEmptiesWarehouse = (warehouseName: string | null | undefined): boolean => /\bempties\b/i.test(warehouseName ?? "");

/** One receipt line: a document's movement of one item into or out of one warehouse, in single units (pieces), signed (returns negative). */
export interface PurchaseReceiptRow {
  docType: ReceiptDocType;
  docEntry: number;
  docNum: string;
  /** YYYY-MM-DD */
  docDate: string;
  supplierCode: string;
  supplierName: string;
  itemCode: string;
  itemName: string;
  warehouseCode: string;
  location: string;
  /** Principal-Location key as sales use it (e.g. "Mars-Nairobi"), or "Unallocated". */
  principal: string;
  principalSource: "PRODUCT" | "PREFIX" | "UNALLOCATED";
  stockClass: StockClass;
  /** Net quantity in the item's inventory unit (pieces). */
  qty: number;
  /** qty / pack size from the Product master; 0 when the pack size is unknown. */
  cases: number;
  /** Cost value excl. VAT in KSh, as SAP posted it to stock. */
  value: number;
}
