// Imports the authoritative Journey Plan workbook (one row per planned rep/outlet/date
// visit) from a local source path and posts normalized rows to the production
// dashboard. Re-run this whenever a new Journey Plan is supplied — the upload route
// replaces exactly the calendar months the file's own dates span, leaving every other
// month's already-uploaded plan untouched.
import * as XLSX from "xlsx";

const DEFAULT_WORKBOOK_PATH = "F:\\Raw Reports\\Journey Plan.xlsx";
const DEFAULT_APP_URL = "https://pinefrostdb.com";
const SHEET_NAME = "Journey_Plan";
const BATCH_SIZE = 1000;

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface SourceRow {
  "Customer ID"?: unknown;
  "Customer Name"?: unknown;
  Rep?: unknown;
  UserID?: unknown;
  Day?: unknown;
  Date?: unknown;
  Location?: unknown;
  "Team Leader"?: unknown;
  "Route Name"?: unknown;
  "Sub Region"?: unknown;
  "Sales Role"?: unknown;
  Channel?: unknown;
}

interface JourneyPlanUploadRow {
  date: string;
  day: string;
  employeeCode: string;
  employeeName: string;
  customerId: string;
  customerName: string;
  region: string;
  teamLeader: string;
  routeName: string;
  subRegion: string;
  salesRole: string;
  channel: string;
  monthLabel: string;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function requiredText(row: SourceRow, column: keyof SourceRow, rowNumber: number): string {
  const value = text(row[column]);
  if (!value) throw new Error(`Missing "${String(column)}" on row ${rowNumber}.`);
  return value;
}

export function salesRole(value: unknown, rowNumber: number): string {
  const normalized = text(value).toLowerCase();
  if (normalized === "primary" || normalized === "primary sales") return "Primary Sales";
  if (normalized === "secondary" || normalized === "secondary sales") return "Secondary Sales";
  throw new Error(`Unknown Sales Role on row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

function excelDate(value: unknown, rowNumber: number): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Date on row ${rowNumber}: ${String(value)}.`);
  return parsed;
}

export function monthLabel(date: Date): string {
  return `${MONTH_ABBR[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

function readSheet(workbook: XLSX.WorkBook, name: string): SourceRow[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Workbook is missing the "${name}" sheet.`);
  return XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true });
}

function main(): { rows: JourneyPlanUploadRow[]; workbookPath: string } {
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK_PATH;
  const workbook = XLSX.readFile(workbookPath, { cellDates: true });
  const source = readSheet(workbook, SHEET_NAME);

  const rows = source.map((row, index) => {
    const rowNumber = index + 2;
    const date = excelDate(row.Date, rowNumber);
    return {
      date: date.toISOString(),
      day: requiredText(row, "Day", rowNumber),
      employeeCode: requiredText(row, "UserID", rowNumber),
      employeeName: requiredText(row, "Rep", rowNumber),
      customerId: requiredText(row, "Customer ID", rowNumber),
      customerName: requiredText(row, "Customer Name", rowNumber),
      region: requiredText(row, "Location", rowNumber),
      teamLeader: requiredText(row, "Team Leader", rowNumber),
      routeName: requiredText(row, "Route Name", rowNumber),
      subRegion: requiredText(row, "Sub Region", rowNumber),
      salesRole: salesRole(row["Sales Role"], rowNumber),
      channel: requiredText(row, "Channel", rowNumber),
      monthLabel: monthLabel(date),
    };
  });

  return { rows, workbookPath };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks.length > 0 ? chunks : [[]];
}

async function postJson(appUrl: string, apiKey: string, path: string, body: unknown): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

async function run() {
  process.loadEnvFile();
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const { rows, workbookPath } = main();
  console.log(`[jp-adherence] Read ${rows.length} Journey Plan rows from ${workbookPath}.`);
  if (rows.length === 0) {
    console.log("[jp-adherence] Nothing to upload.");
    return;
  }

  // Replace exactly the calendar months this upload's own dates span — a
  // one-sided delete would wipe every later month too when re-uploading an
  // earlier one (see the upload route's own header comment).
  const dates = rows.map((r) => new Date(r.date));
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
  const windowStart = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1));
  const windowEnd = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth() + 1, 1));
  console.log(`[jp-adherence] Replacing ${windowStart.toISOString().slice(0, 10)} through ${windowEnd.toISOString().slice(0, 10)} (exclusive).`);

  const batches = chunk(rows, BATCH_SIZE);
  let total = 0;
  for (const [i, batch] of batches.entries()) {
    const result = await postJson(appUrl, apiKey, "/api/jp-adherence/upload/plan", {
      rows: batch,
      windowStart: i === 0 ? windowStart.toISOString() : undefined,
      windowEnd: i === 0 ? windowEnd.toISOString() : undefined,
    });
    if (!result.ok) throw new Error(`Batch ${i + 1}/${batches.length} rejected (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
    total += batch.length;
    console.log(`[jp-adherence] Batch ${i + 1}/${batches.length} uploaded (${batch.length} rows).`);
  }
  console.log(`[jp-adherence] Done: uploaded ${total}/${rows.length} rows.`);
}

// Only run when executed directly (tsx scripts/jp-adherence/import-plan.ts),
// not when imported by tests for its pure helpers (salesRole, monthLabel).
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMainModule) {
  run().catch((err) => {
    console.error("[jp-adherence] FAILED:", err);
    process.exitCode = 1;
  });
}
