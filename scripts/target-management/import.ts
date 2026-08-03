// Imports both sheets of the authoritative Target Management workbook from a
// local source path and posts normalized rows to the production dashboard —
// Roster (Team Leader × Employee × Principal, plus the region/HR-style
// reference columns) and Targets Per Principal (monthly company-wide
// targets). Permanent, re-run whenever a new workbook version is supplied —
// both upload routes upsert idempotently, so re-running never duplicates or
// loses rows. The source workbook is never copied into the web container;
// the database holds the durable master.
process.loadEnvFile();

import * as XLSX from "xlsx";

const DEFAULT_WORKBOOK_PATH = "F:\\Raw Reports\\Target_Management_System.xlsm";
const DEFAULT_APP_URL = "https://pinefrostdb.com";
const ROSTER_SHEET = "Roster";
const TARGETS_SHEET = "Targets Per Principal";
// Both sheets carry a 2-row instructions banner above the real header (see the
// workbook's own "Use HOME > 2. Roster..." / "Use the VBA form..." rows) — the
// real header is on row 3, i.e. SheetJS's 0-indexed range start of 2.
const HEADER_RANGE = 2;
const BATCH_SIZE = 500;

const CANONICAL_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type SourceRow = Record<string, unknown>;

interface RosterUploadRow {
  employeeCode: string;
  employeeName: string;
  sapName: string | null;
  channel: string | null;
  teamLeaderName: string;
  principal: string;
  contributionPct: number | null;
  active: boolean;
  salesRole: "PRIMARY" | "SECONDARY";
  company: string | null;
  costCenter: string | null;
  absolutePrincipal: string | null;
  workGroup: string | null;
  region: string | null;
  subRegion: string | null;
  supervisor: string | null;
  costCenterCount: number | null;
  salesPoint: string | null;
  route: string | null;
  location: string | null;
  sourceContributionPct: number | null;
}

interface TargetUploadRow {
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

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function requiredText(row: SourceRow, column: string, rowNumber: number, sheet: string): string {
  const value = text(row[column]);
  if (!value) throw new Error(`Missing "${column}" on ${sheet} row ${rowNumber}.`);
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || text(value) === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function nullableInt(value: unknown): number | null {
  const n = nullableNumber(value);
  return n === null ? null : Math.round(n);
}

function salesRole(value: unknown, rowNumber: number, sheet: string): "PRIMARY" | "SECONDARY" {
  const normalized = text(value).toLowerCase();
  if (normalized === "primary" || normalized === "primary sales") return "PRIMARY";
  if (normalized === "secondary" || normalized === "secondary sales") return "SECONDARY";
  throw new Error(`Unknown Sales Role on ${sheet} row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

function activeFlag(value: unknown, rowNumber: number): boolean {
  const normalized = text(value).toUpperCase();
  if (normalized === "Y") return true;
  if (normalized === "N") return false;
  throw new Error(`Unknown Active (Y/N) on Roster row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

// SheetJS's cellDates:true conversion is unreliable for this workbook family
// (see scripts/jp-adherence/import-plan.ts's own header comment for the same
// issue on Journey Plan) — reading the raw numeric serial and converting by
// hand avoids it. Excel's epoch is 1899-12-30, not 1900-01-01, to account for
// Excel's own fake-1900-leap-year bug.
const EXCEL_EPOCH_UTC_MS = Date.UTC(1899, 11, 30);
function excelDate(value: unknown, rowNumber: number): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(EXCEL_EPOCH_UTC_MS + Math.round(value) * 86400000);
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Period on Targets Per Principal row ${rowNumber}: ${String(value)}.`);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function readSheet(workbook: XLSX.WorkBook, name: string): SourceRow[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) throw new Error(`Workbook is missing the "${name}" sheet.`);
  return XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true, range: HEADER_RANGE });
}

function parseRoster(workbook: XLSX.WorkBook): RosterUploadRow[] {
  const source = readSheet(workbook, ROSTER_SHEET);
  return source
    .filter((row) => text(row["Employee Code"]) !== "")
    .map((row, index) => {
      const rowNumber = index + 4; // +2 banner rows +1 header row +1 for 1-indexing
      return {
        employeeCode: requiredText(row, "Employee Code", rowNumber, ROSTER_SHEET),
        employeeName: requiredText(row, "Employee (Sales Edge Name)", rowNumber, ROSTER_SHEET),
        sapName: nullableText(row["SAP Name"]),
        channel: nullableText(row.Channel),
        teamLeaderName: requiredText(row, "Team Leader", rowNumber, ROSTER_SHEET),
        principal: requiredText(row, "Principal", rowNumber, ROSTER_SHEET),
        contributionPct: nullableNumber(row["* Contribution %"]),
        active: activeFlag(row["Active (Y/N)"], rowNumber),
        salesRole: salesRole(row["Sales Role"], rowNumber, ROSTER_SHEET),
        company: nullableText(row.Company),
        costCenter: nullableText(row["Cost Center"]),
        absolutePrincipal: nullableText(row["Absolute Principal"]),
        workGroup: nullableText(row["Work Group"]),
        region: nullableText(row.Region),
        subRegion: nullableText(row["Sub Region"]),
        supervisor: nullableText(row.Supervisor),
        costCenterCount: nullableInt(row["Cost Center Count"]),
        salesPoint: nullableText(row["Sales Point"]),
        route: nullableText(row.Route),
        location: nullableText(row.Location),
        sourceContributionPct: nullableNumber(row["Source Contribution %"]),
      };
    });
}

function parseTargets(workbook: XLSX.WorkBook): TargetUploadRow[] {
  const source = readSheet(workbook, TARGETS_SHEET);
  return source
    .filter((row) => row.Period !== null && row.Period !== undefined)
    .map((row, index) => {
      const rowNumber = index + 4;
      const date = excelDate(row.Period, rowNumber);
      return {
        year: String(date.getUTCFullYear()),
        month: CANONICAL_MONTHS[date.getUTCMonth()],
        monthIndex: date.getUTCMonth(),
        principal: requiredText(row, "Principal", rowNumber, TARGETS_SHEET),
        mainPrincipal: nullableText(row["Main Principal"]),
        valueTarget: nullableNumber(row["* Value Target"]),
        volumeTarget: nullableNumber(row["* Volume Target"]),
        coverageTarget: nullableNumber(row["* Coverage Target"]),
        productivityTarget: nullableNumber(row["* Productivity Target"]),
      };
    });
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
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY in .env.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const workbookPath = process.argv[2] || DEFAULT_WORKBOOK_PATH;

  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const roster = parseRoster(workbook);
  const targets = parseTargets(workbook);
  console.log(`[target-management] Read ${roster.length} Roster rows and ${targets.length} Target rows from ${workbookPath}.`);

  let rosterUploaded = 0;
  for (const batch of chunk(roster, BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const result = await postJson(appUrl, apiKey, "/api/team-leaders/upload", { rows: batch });
    if (!result.ok) throw new Error(`Roster batch rejected (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
    rosterUploaded += batch.length;
    console.log(`[target-management] Roster: ${rosterUploaded}/${roster.length} uploaded.`);
  }

  let targetsUploaded = 0;
  for (const batch of chunk(targets, BATCH_SIZE)) {
    if (batch.length === 0) continue;
    const result = await postJson(appUrl, apiKey, "/api/targets/upload", { rows: batch });
    if (!result.ok) throw new Error(`Targets batch rejected (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
    targetsUploaded += batch.length;
    console.log(`[target-management] Targets: ${targetsUploaded}/${targets.length} uploaded.`);
  }

  console.log(`[target-management] Done: ${rosterUploaded} Roster row(s), ${targetsUploaded} Target row(s).`);
}

run().catch((err) => {
  console.error("[target-management] FAILED:", err);
  process.exitCode = 1;
});
