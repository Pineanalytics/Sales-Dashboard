// Imports the authoritative Employee Roaster workbook from a local source path
// and posts normalized rows to the production dashboard. The source workbook is
// never copied into the web container; the database holds the durable master.
process.loadEnvFile();

import * as XLSX from "xlsx";

const DEFAULT_WORKBOOK_PATH = "F:\\Raw Reports\\Employee Roaster.xlsx";
const DEFAULT_APP_URL = "https://pinefrostdb.com";

type SourceRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function requiredText(row: SourceRow, column: string, rowNumber: number): string {
  const value = text(row[column]);
  if (!value) throw new Error(`Missing ${column} on row ${rowNumber}.`);
  return value;
}

function salesRole(value: unknown, rowNumber: number): "Primary Sales" | "Secondary Sales" {
  const normalized = text(value).toLowerCase();
  if (normalized === "primary" || normalized === "primary sales") return "Primary Sales";
  if (normalized === "secondary" || normalized === "secondary sales") return "Secondary Sales";
  throw new Error(`Unknown Sales Role on row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

function activityStatus(value: unknown, rowNumber: number): boolean {
  const normalized = text(value).toLowerCase();
  if (normalized === "active") return true;
  if (normalized === "inactive") return false;
  throw new Error(`Unknown ActivityStatus on row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

function asInteger(value: unknown, column: string, rowNumber: number): number | null {
  if (value === null || value === undefined || text(value) === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result)) throw new Error(`${column} must be an integer on row ${rowNumber}.`);
  return result;
}

function asFraction(value: unknown, column: string, rowNumber: number): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`${column} must be a non-negative number on row ${rowNumber}.`);
  return result;
}

function readSheet(workbook: XLSX.WorkBook, name: string): SourceRow[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Workbook is missing the "${name}" sheet.`);
  return XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true });
}

function main() {
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK_PATH;
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const roster = readSheet(workbook, "Employee Roaster");
  const contribution = readSheet(workbook, "Contribution");

  const employees = roster.map((row, index) => {
    const rowNumber = index + 2;
    return {
      employeeCode: requiredText(row, "UserID", rowNumber),
      company: nullableText(row.Company),
      pineName: requiredText(row, "Sales Rep Name", rowNumber),
      sapName: requiredText(row, "SAP Rep Name", rowNumber),
      absolutePrincipal: requiredText(row, "Principal", rowNumber),
      salesRole: salesRole(row["Sales Role"], rowNumber),
      workGroup: nullableText(row["Work Group"]),
      region: nullableText(row.Region),
      subRegion: nullableText(row["Sub Region"]),
      teamLeader: nullableText(row["Team Leader"]),
      supervisor: nullableText(row.Supervisor),
      active: activityStatus(row.ActivityStatus, rowNumber),
      costCenterCount: asInteger(row.CostCenterCount, "CostCenterCount", rowNumber),
      salesPoint: nullableText(row["Sales Point"]),
      route: nullableText(row.Route),
      location: nullableText(row.Location),
    };
  });

  const contributions = contribution.map((row, index) => {
    const rowNumber = index + 2;
    return {
      employeeCode: requiredText(row, "UserID", rowNumber),
      principal: requiredText(row, "Principal", rowNumber),
      salesRole: salesRole(row["Sales Role"], rowNumber),
      contributionPct: asFraction(row.Contribution, "Contribution", rowNumber),
    };
  });

  const employeeCodes = new Set(employees.map((row) => row.employeeCode));
  if (employeeCodes.size !== employees.length) throw new Error("Employee Roaster contains duplicate UserID values.");
  if (contributions.some((row) => !employeeCodes.has(row.employeeCode))) throw new Error("Contribution contains a UserID not present in Employee Roaster.");

  return { employees, contributions, workbookPath };
}

async function run() {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const payload = main();
  console.log(`[employee-master] Read ${payload.employees.length} Employee Roaster rows and ${payload.contributions.length} Contribution rows from ${payload.workbookPath}.`);

  const response = await fetch(`${appUrl}/api/employee-master/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({ employees: payload.employees, contributions: payload.contributions }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Import rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  console.log(`[employee-master] Import succeeded: ${JSON.stringify(body)}`);
}

run().catch((err) => {
  console.error("[employee-master] FAILED:", err);
  process.exitCode = 1;
});
