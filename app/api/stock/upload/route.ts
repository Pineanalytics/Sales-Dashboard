import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";
import { compareDirectStockToLatestExcel } from "@/lib/stockSync";

export const runtime = "nodejs";

interface StockUploadRow {
  principal: string;
  item: string;
  itemCode: string;
  openingVolume: number;
  openingPcs: number;
  openingValue: number;
  rrWeekValue: number;
  rrWeekVolume: number;
  daysCover: number;
  action: string;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function nonBlankText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidRow(value: unknown): value is StockUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return nonBlankText(row.principal) && nonBlankText(row.item) && nonBlankText(row.itemCode) && nonBlankText(row.action)
    && finiteNumber(row.openingVolume) && finiteNumber(row.openingPcs) && finiteNumber(row.openingValue)
    && finiteNumber(row.rrWeekValue) && finiteNumber(row.rrWeekVolume) && finiteNumber(row.daysCover);
}

function parseSourceDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a direct SAP stock JSON payload." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const sourceDate = parseSourceDate(payload.sourceDate);
  const rows = payload.rows;
  const physicalSourceRows = payload.physicalSourceRows;
  const demandSourceRows = payload.demandSourceRows;
  const matchedDemandRows = payload.matchedDemandRows;
  if (!sourceDate || !Array.isArray(rows) || rows.length === 0 || !rows.every(isValidRow)
    || !Number.isInteger(physicalSourceRows) || !Number.isInteger(demandSourceRows) || !Number.isInteger(matchedDemandRows)) {
    return NextResponse.json({ error: "Stock payload is incomplete or contains invalid values." }, { status: 400 });
  }

  const stockRows = rows as StockUploadRow[];
  const distinctKeys = new Set(stockRows.map((row) => `${row.principal}\u0000${row.item}`));
  if (distinctKeys.size !== stockRows.length) return NextResponse.json({ error: "Direct stock contains duplicate Principal + Item rows." }, { status: 400 });

  try {
    const comparison = await compareDirectStockToLatestExcel(stockRows);
    await prisma.$transaction(async (tx) => {
      // Delete only after every validation and Excel comparison has completed;
      // one complete new snapshot always replaces one complete old snapshot.
      await tx.stockActual.deleteMany();
      await tx.stockActual.createMany({
        data: stockRows.map((row) => ({ ...row, sourceDate })),
      });
      await tx.stockSyncRun.create({
        data: {
          sourceDate,
          rowCount: stockRows.length,
          physicalSourceRows: physicalSourceRows as number,
          demandSourceRows: demandSourceRows as number,
          matchedDemandRows: matchedDemandRows as number,
          excelSnapshotId: comparison.excelSnapshotId,
          excelRowCount: comparison.excelRows,
          matchedExcelRows: comparison.matchedRows,
          onlySapRows: comparison.onlySapRows,
          onlyExcelRows: comparison.onlyExcelRows,
          excelStockValue: comparison.excelStockValue,
          directStockValue: comparison.directStockValue,
          stockValueVariancePct: comparison.stockValueVariancePct,
        },
      });
    });
    invalidateDatasetCache();
    return NextResponse.json({ count: stockRows.length, comparison }, { status: 200 });
  } catch (error) {
    console.error("Failed to replace direct SAP stock snapshot", error);
    return NextResponse.json({ error: "Failed to save direct SAP stock snapshot." }, { status: 500 });
  }
}
