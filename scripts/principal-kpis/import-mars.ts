// Imports the Mars source workbooks into the Principal KPIs workspace.  The
// workbooks stay on the office machine: this script sends only normalised,
// API-key-authenticated rows to the dashboard.  Actuals are replaced as a
// complete source snapshot, so re-running is safe and never double-counts.
process.loadEnvFile();

import { spawn } from "node:child_process";
import * as XLSX from "xlsx";

const DEFAULT_APP_URL = "https://pinefrostdb.com";
const DEFAULT_DIR = "D:\\Mars Update";
const BATCH_SIZE = 750;
type Row = Record<string, unknown>;

function string(value: unknown): string { return String(value ?? "").trim(); }
function nullable(value: unknown): string | null { const result = string(value); return result || null; }
function numeric(value: unknown): number { const result = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "")); return Number.isFinite(result) ? result : 0; }
function nullableNumber(value: unknown): number | null { return value === null || value === undefined || string(value) === "" ? null : numeric(value); }
function field(row: Row, ...names: string[]): unknown { for (const name of names) if (Object.prototype.hasOwnProperty.call(row, name)) return row[name]; return null; }
function periodNo(value: unknown): number { const match = string(value).match(/(?:P)?\s*0*(\d{1,2})/i); const n = match ? Number(match[1]) : numeric(value); if (!Number.isInteger(n) || n < 1 || n > 13) throw new Error(`Invalid fiscal period: ${string(value)}`); return n; }
function periodKey(value: unknown): string { return `P${String(periodNo(value)).padStart(2, "0")}`; }
function excelDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000);
  const parsed = new Date(string(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid date: ${string(value)}`);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}
function isoDate(value: unknown): string { return excelDate(value).toISOString(); }
function rows(workbook: XLSX.WorkBook, name: string): Row[] { const sheet = workbook.Sheets[name]; if (!sheet) throw new Error(`Workbook is missing sheet "${name}".`); return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: true }); }
// SheetJS 0.18 does not materialise large worksheet objects when `dense` is
// requested from this workbook family (it returns the names but an empty
// Sheets map).  Keep the standard sparse representation; the Node heap cap in
// package.json's import command still leaves ample headroom for the raw file.
function read(path: string) { return XLSX.readFile(path, { cellDates: false }); }
function chunks<T>(values: T[]): T[][] { const result: T[][] = []; for (let i = 0; i < values.length; i += BATCH_SIZE) result.push(values.slice(i, i + BATCH_SIZE)); return result; }

async function post(appUrl: string, apiKey: string, body: unknown) {
  const response = await fetch(`${appUrl}/api/principal-kpis/mars`, { method: "POST", headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Mars import rejected (HTTP ${response.status}): ${text}`);
}

function buildPeriods(workbook: XLSX.WorkBook) {
  const source = rows(workbook, "Period Key");
  // The source sheet uses `Period` for the Excel date and `PO` for P01…P13.
  const starts = source.map((row) => ({ periodKey: periodKey(field(row, "PO", "Period Key")), periodNo: periodNo(field(row, "PO", "Period Key")), startDate: excelDate(field(row, "Period", "Start Date", "StartDate", "Date")) })).sort((a, b) => a.periodNo - b.periodNo);
  if (starts.length !== 13 || new Set(starts.map((row) => row.periodNo)).size !== 13) throw new Error("Mars Period Key must contain P01 through P13 exactly once.");
  const current = starts.map((row, index) => ({ fiscalYear: String(row.startDate.getUTCFullYear() + (row.periodNo === 1 ? 1 : 0)), periodKey: row.periodKey, periodNo: row.periodNo, startDate: row.startDate.toISOString(), endDate: new Date((starts[index + 1]?.startDate.getTime() ?? row.startDate.getTime() + 28 * 86_400_000) - 86_400_000).toISOString() }));
  // Mars's 52-week fiscal calendar repeats the period sequence 364 days prior.
  return [...current, ...current.map((row) => ({ ...row, fiscalYear: String(Number(row.fiscalYear) - 1), startDate: new Date(new Date(row.startDate).getTime() - 364 * 86_400_000).toISOString(), endDate: new Date(new Date(row.endDate).getTime() - 364 * 86_400_000).toISOString() }))];
}

function buildProducts(workbook: XLSX.WorkBook) {
  return rows(workbook, "Products").filter((row) => string(field(row, "Item No.", "Item No", "ItemId"))).map((row) => ({ itemNo: string(field(row, "Item No.", "Item No", "ItemId")), itemName: string(field(row, "Item Description", "ItemName", "Item Name")), packSize: nullableNumber(field(row, "Pack size", "Pack Size")), brand: nullable(field(row, "Brand")), classification: nullable(field(row, "Classification")), ssuConversion: nullableNumber(field(row, "SSU Conversion", "SSU conversion")) }));
}

function buildRoster(workbook: XLSX.WorkBook) {
  return rows(workbook, "Employees").filter((row) => string(field(row, "Employee Code", "UserID", "User ID"))).map((row) => ({ employeeCode: string(field(row, "Employee Code", "UserID", "User ID")), employeeName: string(field(row, "Employee", "Employee Name", "User Name")), employeeGroup: nullable(field(row, "Employee Group", "EmployeeGroup", "Group")), location: nullable(field(row, "Location")), teamLeader: nullable(field(row, "Team Leader", "TL")), fsr: nullable(field(row, "FSR")), sellerType: nullable(field(row, "Seller Type")), activeDays: nullableNumber(field(row, "Active Days")) === null ? null : Math.round(nullableNumber(field(row, "Active Days"))!), active: true }));
}

function buildTargets(workbook: XLSX.WorkBook) {
  const combined = new Map<string, ReturnType<typeof targetRow>>();
  for (const [index, row] of rows(workbook, "Targets").entries()) {
    const mapped = targetRow(row, index + 2);
    const key = `${mapped.fiscalYear}|${mapped.periodKey}|${mapped.employeeCode}`;
    const existing = combined.get(key);
    if (!existing) combined.set(key, mapped);
    else {
      for (const name of ["volumeTarget", "valueTarget", "universeTarget", "coverageTarget", "ssuTarget"] as const) existing[name] = (existing[name] ?? 0) + (mapped[name] ?? 0);
    }
  }
  return [...combined.values()];
}
function targetRow(row: Row, rowNumber: number) {
  const employeeCode = string(field(row, "Employee Code", "UserID", "User ID"));
  if (!employeeCode) throw new Error(`Targets row ${rowNumber} has no Employee Code.`);
  const date = excelDate(field(row, "Period"));
  const fiscalYear = string(field(row, "Fiscal Year", "Year")) || String(date.getUTCFullYear() + (date.getUTCMonth() === 11 ? 1 : 0));
  return { fiscalYear, periodKey: periodKey(field(row, "PO", "Period Number", "Period Key")), periodNo: periodNo(field(row, "PO", "Period Number", "Period Key")), employeeCode, employeeName: nullable(field(row, "Employee", "Employee Name")), employeeGroup: nullable(field(row, "Group", "Employee Group")), location: nullable(field(row, "Location")), teamLeader: nullable(field(row, "Team Leader", "TL")), fsr: nullable(field(row, "FSR")), sellerType: nullable(field(row, "Seller Type")), volumeTarget: nullableNumber(field(row, "Volume")), valueTarget: nullableNumber(field(row, "Value")), universeTarget: nullableNumber(field(row, "Universe")), coverageTarget: nullableNumber(field(row, "Coverage")), ssuTarget: nullableNumber(field(row, "SSU")) };
}

function decodeXml(value: string) { return value.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function columnIndex(ref: string) { let result = 0; for (const letter of ref.replace(/\d/g, "")) result = result * 26 + letter.charCodeAt(0) - 64; return result - 1; }
function cellText(cell: string, shared: string[]): string | null {
  const attrs = cell.match(/^<c\b([^>]*)>/)?.[1] ?? "";
  const type = attrs.match(/\bt="([^"]+)"/)?.[1];
  const raw = cell.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? cell.match(/<is[^>]*>([\s\S]*?)<\/is>/)?.[1];
  if (raw === undefined) return null;
  const value = decodeXml(raw);
  return type === "s" ? shared[Number(value)] ?? null : value;
}
function rowObject(xml: string, shared: string[]): Row {
  const result: Row = {};
  for (const match of xml.matchAll(/(<c\b[\s\S]*?<\/c>)/g)) {
    const cell = match[1];
    const ref = cell.match(/^<c\b[^>]*\br="([A-Z]+)\d+"/)?.[1];
    const value = cellText(cell, shared);
    if (ref && value !== null) result[String(columnIndex(ref))] = value;
  }
  return result;
}

/** Reads selected XLSX XML entries without turning the 500MB+ raw worksheet
 * into one JavaScript string.  The normal SheetJS reader is ideal for the
 * reference workbooks, but this raw export exceeds its string limit. */
async function streamXlsxEntry(path: string, name: string, onChunk: (text: string, final: boolean) => Promise<void> | void): Promise<void> {
  // `tar.exe -xOf` is Windows' built-in ZIP entry stream.  Unlike the
  // JavaScript XLSX/ZIP readers it handles each >500MB worksheet separately,
  // so the LYTD sheet cannot be silently skipped after the YTD sheet.
  const child = spawn("tar.exe", ["-xOf", path, name], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const decoder = new TextDecoder();
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const closed = new Promise<number | null>((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
  // Awaiting each chunk applies natural stream backpressure.  When a 750-row
  // batch is posted below, tar pauses instead of filling the process heap with
  // every pending API request from a 500MB worksheet.
  for await (const chunk of child.stdout) await onChunk(decoder.decode(chunk, { stream: true }), false);
  const code = await closed;
  if (code !== 0) throw new Error(`Unable to read XLSX entry ${name}: ${stderr.trim() || `tar exited ${code}`}`);
  await onChunk(decoder.decode(), true);
}

async function readSharedStrings(path: string): Promise<string[]> {
  const shared: string[] = [];
  let buffer = "";
  try {
    await streamXlsxEntry(path, "xl/sharedStrings.xml", (text, final) => {
      buffer += text;
      for (;;) {
        const end = buffer.indexOf("</si>");
        if (end < 0) break;
        const start = buffer.indexOf("<si");
        if (start < 0 || start > end) { buffer = buffer.slice(end + 5); continue; }
        shared.push(decodeXml(buffer.slice(start, end + 5)));
        buffer = buffer.slice(end + 5);
      }
      if (final && buffer.includes("<si")) throw new Error("Mars shared strings XML ended unexpectedly.");
    });
  } catch (error) {
    // This export stores text inline, so sharedStrings.xml is legitimately
    // absent.  Keep the parser compatible with both XLSX encodings.
    if (!(error instanceof Error) || !error.message.includes("Not found in archive")) throw error;
  }
  return shared;
}

async function uploadActuals(path: string, appUrl: string, apiKey: string) {
  const shared = await readSharedStrings(path);
  const sheets = ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"];
  const headers = new Map<string, Record<string, string>>();
  const buffers = new Map<string, string>();
  let batch: ReturnType<typeof actualRow>[] = [];
  let uploaded = 0;
  let reset = true;
  const uploadBatch = async () => {
    if (batch.length === 0) return;
    const payload = batch;
    const isReset = reset;
    batch = [];
    reset = false;
    await post(appUrl, apiKey, { kind: "actuals", rows: payload, reset: isReset });
    uploaded += payload.length;
    if (uploaded === payload.length || uploaded % (BATCH_SIZE * 25) === 0) console.log(`[mars-kpis] Actuals: ${uploaded} uploaded.`);
  };
  for (const sheetName of sheets) await streamXlsxEntry(path, sheetName, async (text, final) => {
    let buffer = (buffers.get(sheetName) ?? "") + text;
    for (;;) {
      const end = buffer.indexOf("</row>");
      if (end < 0) break;
      const start = buffer.indexOf("<row");
      if (start < 0 || start > end) { buffer = buffer.slice(end + 6); continue; }
      const rowXml = buffer.slice(start, end + 6);
      buffer = buffer.slice(end + 6);
      const values = rowObject(rowXml, shared);
      const rowNumber = Number(rowXml.match(/<row\b[^>]*\br="(\d+)"/)?.[1] ?? "0");
      if (rowNumber === 1) { headers.set(sheetName, Object.fromEntries(Object.entries(values).map(([column, value]) => [value, column]))); continue; }
      const header = headers.get(sheetName);
      if (!header) throw new Error(`Mars raw sheet ${sheetName} has no header row.`);
      const row = Object.fromEntries(Object.entries(header).map(([name, column]) => [name, values[column] ?? null]));
      if (!string(field(row, "CustomerID", "Customer Id")) || !string(field(row, "ItemId", "Item ID", "SapCode"))) continue;
      // A small number of exported raw rows lack the worksheet's calculated
      // Fiscal Year helper even though the sheet itself is explicitly YTD
      // (current FY) or LYTD (prior FY).  The sheet boundary is authoritative
      // for those rows and keeps a blank helper from halting a full reload.
      batch.push(actualRow(row, `${sheetName}|${rowNumber}`, sheetName.endsWith("sheet1.xml") ? "2026" : "2025"));
      if (batch.length >= BATCH_SIZE) await uploadBatch();
    }
    buffers.set(sheetName, buffer);
    if (final && buffer.includes("<row")) throw new Error(`Mars raw sheet ${sheetName} ended with an incomplete row.`);
  });
  await uploadBatch();
  if (uploaded === 0) throw new Error("No Mars actual sales lines were found in the YTD/LYTD sheets.");
  return uploaded;
}
function actualRow(row: Row, sourceKey: string, sheetFiscalYear?: string) {
  // The LYTD tab retains the FY26 calculated helper from its source template.
  // Its tab boundary is the authoritative fiscal-year declaration; only use a
  // row helper for a source which has no such tab-level period context.
  const fiscalYear = sheetFiscalYear || string(field(row, "Fiscal Year", "FiscalYear"));
  if (!fiscalYear) throw new Error(`Actual line ${sourceKey} is missing Fiscal Year.`);
  return { sourceKey, fiscalYear, periodKey: periodKey(field(row, "Period Number", "Period")), periodNo: periodNo(field(row, "Period Number", "Period")), date: isoDate(field(row, "Date")), employeeCode: nullable(field(row, "UserID", "User ID", "Employee Code")), employeeName: nullable(field(row, "Employee", "Employee Name")), employeeGroup: nullable(field(row, "EmployeeGroup", "Employee Group")), location: nullable(field(row, "Location")), teamLeader: nullable(field(row, "Team Leader")), fsr: nullable(field(row, "FSR")), sellerType: nullable(field(row, "Seller Type")), customerId: string(field(row, "CustomerID", "Customer Id")), customerName: nullable(field(row, "CustomerName", "Customer Name")), channel: nullable(field(row, "Channel", "Chanell")), territory: nullable(field(row, "Territory")), itemNo: nullable(field(row, "SapCode", "ItemId", "Item ID")), itemName: nullable(field(row, "ItemName", "Item Name")), brand: nullable(field(row, "Brand")), classification: nullable(field(row, "Classification")), qty: numeric(field(row, "QTY", "Qty")), cases: numeric(field(row, "Cases")), ssu: numeric(field(row, "ssu", "SSU")), revenue: numeric(field(row, "Revenue")), invoiceNo: nullable(field(row, "InvoiceNo", "Invoice No")) };
}

async function main() {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const dir = process.argv[2] || DEFAULT_DIR;
  const targets = read(`${dir}\\Productive Target.xlsx`);
  const products = read(`${dir}\\ProductMasterData.xlsx`);
  const rawPath = `${dir}\\Mars Raw Data_PTD.xlsx`;
  const reference = { kind: "reference", periods: buildPeriods(targets), products: buildProducts(products), roster: buildRoster(targets), targets: buildTargets(targets) };
  console.log(`[mars-kpis] Reference: ${reference.periods.length} periods, ${reference.products.length} products, ${reference.roster.length} roster rows, ${reference.targets.length} targets.`);
  await post(appUrl, apiKey, reference);
  console.log(`[mars-kpis] Reading and uploading raw YTD/LYTD sales lines in ${BATCH_SIZE}-row batches…`);
  const imported = await uploadActuals(rawPath, appUrl, apiKey);
  console.log(`[mars-kpis] Completed Mars source import: ${imported} actual sales lines.`);
}
main().catch((error) => { console.error("[mars-kpis] FAILED:", error); process.exitCode = 1; });
