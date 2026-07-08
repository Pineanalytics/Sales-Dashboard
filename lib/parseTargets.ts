// Small dedicated parser for the Targets upload form (app/(protected)/admin/targets),
// independent of the big Sales/Stock/Coverage workbook parser in lib/parseWorkbook.ts.
// Models the real source shape confirmed via the Target_Per_Principal_System.xlsm
// workbook's "Targets Per Principal" sheet: Key | Period (date) | Principal | Main
// Principal | * Value Target | * Volume Target | * Coverage Target | * Productivity Target.
import * as XLSX from "xlsx";
import { CANONICAL_MONTHS } from "./timeIntelligence";

export class TargetsParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetsParseError";
  }
}

export interface ParsedTargetRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  mainPrincipal: string | null;
  valueTarget: number | null;
  volumeTarget: number | null;
  coverageTarget: number | null;
  productivityTarget: number | null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function str(v: unknown): string {
  return isBlank(v) ? "" : String(v).trim();
}

function toNullableNumber(v: unknown): number | null {
  if (isBlank(v)) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    // Excel serial date fallback, in case cellDates parsing didn't apply to this cell.
    const parsed = XLSX.SSF.parse_date_code(v);
    if (!parsed) return null;
    return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  if (typeof v === "string") {
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const TARGET_COLUMNS = [
  "Period",
  "Principal",
  "Main Principal",
  "* Value Target",
  "* Volume Target",
  "* Coverage Target",
  "* Productivity Target",
] as const;

export function parseTargetsWorkbook(buffer: ArrayBuffer): ParsedTargetRow[] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheetName = wb.SheetNames.includes("Targets Per Principal") ? "Targets Per Principal" : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    throw new TargetsParseError(`No sheet found in the uploaded file. Found sheets: ${wb.SheetNames.join(", ")}`);
  }

  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as unknown[][];

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = aoa[i] ?? [];
    if (row.some((c) => str(c) === "Period") && row.some((c) => str(c) === "Principal")) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) {
    throw new TargetsParseError(
      `Could not find a header row with "Period" and "Principal" columns in sheet "${sheetName}".`
    );
  }

  const headerRow = aoa[headerRowIdx];
  const colIdx = new Map<string, number>();
  headerRow.forEach((h, i) => {
    const key = str(h);
    if (key) colIdx.set(key, i);
  });

  for (const required of ["Period", "Principal"]) {
    if (!colIdx.has(required)) {
      throw new TargetsParseError(`Sheet "${sheetName}" is missing expected column "${required}".`);
    }
  }

  const rows: ParsedTargetRow[] = [];
  for (const row of aoa.slice(headerRowIdx + 1)) {
    const principal = str(row[colIdx.get("Principal")!]);
    if (!principal || principal.toLowerCase().includes("total")) continue;

    const period = toDate(row[colIdx.get("Period")!]);
    if (!period) continue;

    const monthIndex = period.getUTCMonth();
    const getCol = (name: (typeof TARGET_COLUMNS)[number]) => (colIdx.has(name) ? row[colIdx.get(name)!] : null);

    rows.push({
      year: String(period.getUTCFullYear()),
      month: CANONICAL_MONTHS[monthIndex],
      monthIndex,
      principal,
      mainPrincipal: colIdx.has("Main Principal") ? str(getCol("Main Principal")) || null : null,
      valueTarget: toNullableNumber(getCol("* Value Target")),
      volumeTarget: toNullableNumber(getCol("* Volume Target")),
      coverageTarget: toNullableNumber(getCol("* Coverage Target")),
      productivityTarget: toNullableNumber(getCol("* Productivity Target")),
    });
  }

  if (rows.length === 0) {
    throw new TargetsParseError(`Sheet "${sheetName}" contains no valid target rows.`);
  }

  return rows;
}
