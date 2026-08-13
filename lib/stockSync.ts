import { prisma } from "./db";
import { normalizePrincipalKey } from "./normalize";
import { decodeDataset } from "./snapshotCodec";
import type { StockItem } from "./types";

export interface DirectStockComparable {
  principal: string;
  item: string;
  openingValue: number;
}

export interface StockComparison {
  excelSnapshotId: string | null;
  excelRows: number | null;
  matchedRows: number | null;
  onlySapRows: number | null;
  onlyExcelRows: number | null;
  excelStockValue: number | null;
  directStockValue: number | null;
  stockValueVariancePct: number | null;
}

function itemKey(principal: string, item: string): string {
  return `${normalizePrincipalKey(principal)}|${item.trim().replace(/\s+/g, " ").toLocaleLowerCase()}`;
}

/** Compares at the dashboard's actual Principal x Item grain. A stock value
 * variance is a directional percentage from Excel to SAP (positive means SAP
 * has more value), and is null rather than misleading when Excel has no total. */
export function compareDirectStockToExcel(directRows: DirectStockComparable[], excelItems: StockItem[], excelSnapshotId: string | null): StockComparison {
  const excelByKey = new Map(excelItems.map((row) => [itemKey(row.principal, row.item), row]));
  let matchedRows = 0;
  let onlySapRows = 0;
  for (const row of directRows) {
    if (excelByKey.has(itemKey(row.principal, row.item))) matchedRows++;
    else onlySapRows++;
  }
  const directKeys = new Set(directRows.map((row) => itemKey(row.principal, row.item)));
  const onlyExcelRows = excelItems.filter((row) => !directKeys.has(itemKey(row.principal, row.item))).length;
  const excelStockValue = excelItems.reduce((total, row) => total + row.openingValue, 0);
  const directStockValue = directRows.reduce((total, row) => total + row.openingValue, 0);
  return {
    excelSnapshotId,
    excelRows: excelItems.length,
    matchedRows,
    onlySapRows,
    onlyExcelRows,
    excelStockValue,
    directStockValue,
    stockValueVariancePct: excelStockValue === 0 ? null : ((directStockValue - excelStockValue) / excelStockValue) * 100,
  };
}

export async function compareDirectStockToLatestExcel(directRows: DirectStockComparable[]): Promise<StockComparison> {
  const snapshot = await prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" }, select: { id: true, data: true } });
  if (!snapshot) {
    return { excelSnapshotId: null, excelRows: null, matchedRows: null, onlySapRows: null, onlyExcelRows: null, excelStockValue: null, directStockValue: null, stockValueVariancePct: null };
  }
  return compareDirectStockToExcel(directRows, decodeDataset(snapshot.data).stockItems, snapshot.id);
}

export interface DirectStockSyncStatus {
  completedAt: Date;
  sourceDate: Date;
  rowCount: number;
  physicalSourceRows: number;
  demandSourceRows: number;
  matchedDemandRows: number;
  dormantOutOfStockRows: number;
  excelSnapshotId: string | null;
  excelRowCount: number | null;
  matchedExcelRows: number | null;
  onlySapRows: number | null;
  onlyExcelRows: number | null;
  excelStockValue: number | null;
  directStockValue: number | null;
  stockValueVariancePct: number | null;
}

export async function getDirectStockSyncStatus(): Promise<DirectStockSyncStatus | null> {
  return prisma.stockSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
}
