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

/** Maps the SAP rows to SapItem records: trimmed text (blank -> null), SAP's Y/N flags as booleans, one record per item code (the first
 *  wins if SAP ever returned a code twice, e.g. through a duplicated price list). Rows without an item code are dropped. */
export function buildSapItems(rows: SapItemMasterRow[], syncedAt: Date): SapItemRecord[] {
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
