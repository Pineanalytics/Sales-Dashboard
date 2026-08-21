// Imports the Mars source workbooks into the Principal KPIs workspace.  The
// workbooks stay on the office machine: this script sends only normalised,
// API-key-authenticated rows to the dashboard.  Actuals are replaced as a
// complete source snapshot, so re-running is safe and never double-counts.
process.loadEnvFile();

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
function read(path: string) { return XLSX.readFile(path, { cellDates: false, dense: true }); }
function chunks<T>(values: T[]): T[][] { const result: T[][] = []; for (let i = 0; i < values.length; i += BATCH_SIZE) result.push(values.slice(i, i + BATCH_SIZE)); return result; }

async function post(appUrl: string, apiKey: string, body: unknown) {
  const response = await fetch(`${appUrl}/api/principal-kpis/mars`, { method: "POST", headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Mars import rejected (HTTP ${response.status}): ${text}`);
}

function buildPeriods(workbook: XLSX.WorkBook) {
  const source = rows(workbook, "Period Key");
  const starts = source.map((row) => ({ periodKey: periodKey(field(row, "Period", "PO")), periodNo: periodNo(field(row, "Period", "PO")), startDate: excelDate(field(row, "Start Date", "StartDate", "Date")) })).sort((a, b) => a.periodNo - b.periodNo);
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

function buildActuals(workbook: XLSX.WorkBook) {
  const result: ReturnType<typeof actualRow>[] = [];
  for (const sheetName of workbook.SheetNames.filter((name) => /^(YTD|LYTD)\b/i.test(name))) {
    for (const [index, row] of rows(workbook, sheetName).entries()) {
      if (!string(field(row, "CustomerID", "Customer Id")) || !string(field(row, "ItemId", "Item ID", "SapCode"))) continue;
      result.push(actualRow(row, `${sheetName}|${index + 2}`));
    }
  }
  if (result.length === 0) throw new Error("No Mars actual sales lines were found in the YTD/LYTD sheets.");
  return result;
}
function actualRow(row: Row, sourceKey: string) {
  const fiscalYear = string(field(row, "Fiscal Year", "FiscalYear"));
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
  const raw = read(`${dir}\\Mars Raw Data_PTD.xlsx`);
  const reference = { kind: "reference", periods: buildPeriods(targets), products: buildProducts(products), roster: buildRoster(targets), targets: buildTargets(targets) };
  console.log(`[mars-kpis] Reference: ${reference.periods.length} periods, ${reference.products.length} products, ${reference.roster.length} roster rows, ${reference.targets.length} targets.`);
  await post(appUrl, apiKey, reference);
  const actuals = buildActuals(raw);
  console.log(`[mars-kpis] Actuals: ${actuals.length} source lines. Uploading in ${BATCH_SIZE}-row batches…`);
  let imported = 0;
  for (const [index, batch] of chunks(actuals).entries()) {
    await post(appUrl, apiKey, { kind: "actuals", rows: batch, reset: index === 0 });
    imported += batch.length;
    if (index === 0 || imported === actuals.length || (index + 1) % 25 === 0) console.log(`[mars-kpis] Actuals: ${imported}/${actuals.length}.`);
  }
  console.log("[mars-kpis] Completed Mars source import.");
}
main().catch((error) => { console.error("[mars-kpis] FAILED:", error); process.exitCode = 1; });
