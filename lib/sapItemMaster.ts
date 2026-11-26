// SAP item master rows (OITM and friends) -> the SapItem mirror. Pure: the SAP read is scripts/db-bridge/queries/itemMaster.ts and the
// writer is scripts/db-bridge/sap-items/sync.ts.

/** One row of the item-master query, as SQL Server returns it. */
export interface SapItemMasterRow {
  ItemCode: string | null;
  ItemName: string | null;
  FrgnName: string | null;
  ItmsGrpCod: number | null;
  ItmsGrpNam: string | null;
  FirmCode: number | null;
  FirmName: string | null;
  InvntryUom: string | null;
  SalUnitMsr: string | null;
  BuyUnitMsr: string | null;
  NumInSale: number | null;
  NumInBuy: number | null;
  OnHand: number | null;
  IsCommited: number | null;
  OnOrder: number | null;
  AvgPrice: number | null;
  LastPurPrc: number | null;
  CardCode: string | null;
  CardName: string | null;
  SuppCatNum: string | null;
  SWW: string | null;
  U_UKLItemCode: string | null;
  U_EABLItemCode: string | null;
  U_ZrepCode: string | null;
  ValidFor: string | null;
  FrozenFor: string | null;
  CreateDate: Date | null;
  UpdateDate: Date | null;
  SellingPrice: number | null;
  SellingCurrency: string | null;
  PurchasePrice: number | null;
  PurchaseCurrency: string | null;
}

export interface SapItemRecord {
  itemCode: string;
  itemName: string | null;
  foreignName: string | null;
  itemGroupCode: number | null;
  itemGroup: string | null;
  manufacturerCode: number | null;
  manufacturer: string | null;
  inventoryUom: string | null;
  salesUom: string | null;
  purchaseUom: string | null;
  unitsPerSalesUnit: number | null;
  unitsPerPurchaseUnit: number | null;
  onHand: number | null;
  committed: number | null;
  onOrder: number | null;
  averageCost: number | null;
  lastPurchasePrice: number | null;
  preferredSupplierCode: string | null;
  preferredSupplier: string | null;
  supplierProductCode: string | null;
  active: boolean | null;
  frozen: boolean | null;
  sapCreatedAt: Date | null;
  sapUpdatedAt: Date | null;
  sellingPrice: number | null;
  sellingCurrency: string | null;
  purchasePrice: number | null;
  purchaseCurrency: string | null;
  syncedAt: Date;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const num = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const flag = (value: string | null | undefined): boolean | null => {
  const v = value?.trim().toUpperCase();
  return v === "Y" ? true : v === "N" ? false : null;
};

const date = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

type ProductCodeField = "SuppCatNum" | "SWW" | "FrgnName" | "U_UKLItemCode" | "U_EABLItemCode" | "U_ZrepCode";

/** Where SAP holds each brand's own product code, by the letters that start the item code; the first field with a code wins. SuppCatNum,
 *  SAP's standard field for it, is read first for every item. Set from SAP's item master on 26 Nov 2026: a prefix not listed holds
 *  nothing but SAP's own item codes in these fields. KMFY reads Foreign Name first because its U_UKLItemCode repeats across products. */
export const PRODUCT_CODE_FIELDS: Record<string, ProductCodeField[]> = {
  UKL: ["U_UKLItemCode", "SWW"],
  KMFY: ["FrgnName", "U_UKLItemCode"],
  TR: ["U_UKLItemCode"],
  UDV: ["U_EABLItemCode"],
  KBL: ["U_EABLItemCode"],
  MARS: ["U_ZrepCode"],
  UP: ["SWW"],
  MOV: ["SWW"],
  TPL: ["FrgnName", "SWW"],
  BIC: ["FrgnName"],
  DEL: ["FrgnName"],
  SUN: ["FrgnName"],
  JUB: ["FrgnName"],
};

/** The supplier's product code for one item, or null. A value that is one of SAP's own item codes (often copied into these fields) or
 *  only zeros is not a supplier's code. `sapCodes` holds every SAP item code in capitals. */
export function supplierProductCode(row: SapItemMasterRow, sapCodes: ReadonlySet<string>): string | null {
  const prefix = /^[A-Z]*/.exec(text(row.ItemCode)?.toUpperCase() ?? "")?.[0] ?? "";
  for (const field of ["SuppCatNum" as const, ...(PRODUCT_CODE_FIELDS[prefix] ?? [])]) {
    const value = text(row[field]);
    if (value && !sapCodes.has(value.toUpperCase()) && !/^0+$/.test(value)) return value;
  }
  return null;
}

/** Maps the SAP rows to SapItem records: trimmed text (blank -> null), SAP's Y/N flags as booleans, one record per item code (the first
 *  wins if SAP ever returned a code twice, e.g. through a duplicated price list). Rows without an item code are dropped. */
export function buildSapItems(rows: SapItemMasterRow[], syncedAt: Date): SapItemRecord[] {
  const sapCodes = new Set(rows.map((r) => text(r.ItemCode)?.toUpperCase() ?? ""));
  const byCode = new Map<string, SapItemRecord>();
  for (const r of rows) {
    const itemCode = text(r.ItemCode);
    if (!itemCode || byCode.has(itemCode)) continue;
    byCode.set(itemCode, {
      itemCode,
      itemName: text(r.ItemName),
      foreignName: text(r.FrgnName),
      itemGroupCode: num(r.ItmsGrpCod),
      itemGroup: text(r.ItmsGrpNam),
      manufacturerCode: num(r.FirmCode),
      manufacturer: text(r.FirmName),
      inventoryUom: text(r.InvntryUom),
      salesUom: text(r.SalUnitMsr),
      purchaseUom: text(r.BuyUnitMsr),
      unitsPerSalesUnit: num(r.NumInSale),
      unitsPerPurchaseUnit: num(r.NumInBuy),
      onHand: num(r.OnHand),
      committed: num(r.IsCommited),
      onOrder: num(r.OnOrder),
      averageCost: num(r.AvgPrice),
      lastPurchasePrice: num(r.LastPurPrc),
      preferredSupplierCode: text(r.CardCode),
      preferredSupplier: text(r.CardName),
      supplierProductCode: supplierProductCode(r, sapCodes),
      active: flag(r.ValidFor),
      frozen: flag(r.FrozenFor),
      sapCreatedAt: date(r.CreateDate),
      sapUpdatedAt: date(r.UpdateDate),
      sellingPrice: num(r.SellingPrice),
      sellingCurrency: text(r.SellingCurrency),
      purchasePrice: num(r.PurchasePrice),
      purchaseCurrency: text(r.PurchaseCurrency),
      syncedAt,
    });
  }
  return [...byCode.values()];
}
