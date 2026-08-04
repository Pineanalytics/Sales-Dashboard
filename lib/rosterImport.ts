// Shared Roster-import logic for Target_Management_System.xlsm's "Roster" sheet
// (Team Leader x Employee x Principal, plus the region/HR-style reference columns).
// Reused by two entry points that both need the same parse + upsert behavior:
// scripts/target-management/import.ts (xlsm, posted over HTTPS to production) and
// app/(protected)/admin/team-leaders/actions.ts's uploadRosterCsvAction (a plain CSV
// export of the same sheet, uploaded directly through the browser — no local script
// run required). app/api/team-leaders/upload/route.ts is the API-key-gated HTTP
// entry point the script posts to; it also calls upsertRosterRows directly.
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

export interface RosterUploadRow {
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

type SourceRow = Record<string, unknown>;

export class RosterParseError extends Error {}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function requiredText(row: SourceRow, column: string, rowNumber: number): string {
  const value = text(row[column]);
  if (!value) throw new RosterParseError(`Missing "${column}" on Roster row ${rowNumber}.`);
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

function salesRoleValue(value: unknown, rowNumber: number): "PRIMARY" | "SECONDARY" {
  const normalized = text(value).toLowerCase();
  if (normalized === "primary" || normalized === "primary sales") return "PRIMARY";
  if (normalized === "secondary" || normalized === "secondary sales") return "SECONDARY";
  throw new RosterParseError(`Unknown Sales Role on Roster row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

function activeFlag(value: unknown, rowNumber: number): boolean {
  const normalized = text(value).toUpperCase();
  if (normalized === "Y") return true;
  if (normalized === "N") return false;
  throw new RosterParseError(`Unknown Active (Y/N) on Roster row ${rowNumber}: ${text(value) || "(blank)"}.`);
}

/** Maps already-read sheet rows (SheetJS's sheet_to_json output) into upload rows.
 *  rowNumberOffset accounts for however many header/banner rows precede the data in
 *  the caller's own source (e.g. +4 for the xlsm's 2-row banner + header row + 1-index,
 *  +2 for a plain CSV export with just its own header row). */
export function parseRosterSourceRows(source: SourceRow[], rowNumberOffset: number): RosterUploadRow[] {
  return source
    .filter((row) => text(row["Employee Code"]) !== "")
    .map((row, index) => {
      const rowNumber = index + rowNumberOffset;
      return {
        employeeCode: requiredText(row, "Employee Code", rowNumber),
        employeeName: requiredText(row, "Employee (Sales Edge Name)", rowNumber),
        sapName: nullableText(row["SAP Name"]),
        channel: nullableText(row.Channel),
        teamLeaderName: requiredText(row, "Team Leader", rowNumber),
        principal: requiredText(row, "Principal", rowNumber),
        contributionPct: nullableNumber(row["* Contribution %"]),
        active: activeFlag(row["Active (Y/N)"], rowNumber),
        salesRole: salesRoleValue(row["Sales Role"], rowNumber),
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

/** Parses a plain CSV export of the Roster sheet — same 21 columns, but a single
 *  header row (no 2-row instructions banner like the source .xlsm carries). */
export function parseRosterCsv(buffer: Buffer): RosterUploadRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new RosterParseError("The uploaded file has no readable sheet.");
  const sheet = workbook.Sheets[sheetName];
  const source = XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true, range: 0 });
  const rows = parseRosterSourceRows(source, 2); // +1 header row, +1 for 1-indexing
  if (rows.length === 0) throw new RosterParseError('No data rows found — check the file has an "Employee Code" column with values.');
  return rows;
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

export function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

export function isNullableInt(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value));
}

export function isRosterRow(value: unknown): value is RosterUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.employeeCode) &&
    isText(row.employeeName) &&
    isNullableText(row.sapName) &&
    isNullableText(row.channel) &&
    isText(row.teamLeaderName) &&
    isText(row.principal) &&
    isNullableNumber(row.contributionPct) &&
    typeof row.active === "boolean" &&
    (row.salesRole === "PRIMARY" || row.salesRole === "SECONDARY") &&
    isNullableText(row.company) &&
    isNullableText(row.costCenter) &&
    isNullableText(row.absolutePrincipal) &&
    isNullableText(row.workGroup) &&
    isNullableText(row.region) &&
    isNullableText(row.subRegion) &&
    isNullableText(row.supervisor) &&
    isNullableInt(row.costCenterCount) &&
    isNullableText(row.salesPoint) &&
    isNullableText(row.route) &&
    isNullableText(row.location) &&
    isNullableNumber(row.sourceContributionPct)
  );
}

const CHUNK_SIZE = 500;

async function upsertAssignmentsChunk(rows: (RosterUploadRow & { teamLeaderId: string })[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.teamLeaderId}, ${row.employeeCode}, ${row.employeeName}, ${row.principal}, ${row.channel}, ${row.sapName}, ${row.contributionPct}, ${row.active}, ${row.salesRole}, ${row.region}, ${row.subRegion}, ${row.supervisor}, ${row.workGroup}, ${row.company}, ${row.costCenter}, ${row.absolutePrincipal}, ${row.costCenterCount}, ${row.salesPoint}, ${row.route}, ${row.location}, ${row.sourceContributionPct}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "TeamLeaderAssignment"
      (id, "teamLeaderId", "employeeCode", "employeeName", principal, channel, "sapName", "contributionPct", active, "salesRole", region, "subRegion", supervisor, "workGroup", company, "costCenter", "absolutePrincipal", "costCenterCount", "salesPoint", route, location, "sourceContributionPct", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("teamLeaderId", "employeeCode", principal)
    DO UPDATE SET
      "employeeName" = EXCLUDED."employeeName",
      channel = EXCLUDED.channel,
      "sapName" = EXCLUDED."sapName",
      "contributionPct" = EXCLUDED."contributionPct",
      active = EXCLUDED.active,
      "salesRole" = EXCLUDED."salesRole",
      region = EXCLUDED.region,
      "subRegion" = EXCLUDED."subRegion",
      supervisor = EXCLUDED.supervisor,
      "workGroup" = EXCLUDED."workGroup",
      company = EXCLUDED.company,
      "costCenter" = EXCLUDED."costCenter",
      "absolutePrincipal" = EXCLUDED."absolutePrincipal",
      "costCenterCount" = EXCLUDED."costCenterCount",
      "salesPoint" = EXCLUDED."salesPoint",
      route = EXCLUDED.route,
      location = EXCLUDED.location,
      "sourceContributionPct" = EXCLUDED."sourceContributionPct",
      "updatedAt" = now()
  `;
}

/** Upserts TeamLeader (find-or-create by name) then TeamLeaderAssignment rows on
 *  (teamLeaderId, employeeCode, principal) — the same unique key the admin UI's
 *  createAssignmentAction already uses. Every field is fully replaced on every run;
 *  re-running after a new Roster export is always safe and idempotent. A row missing
 *  from a new export is left untouched (no auto-deactivation) — matches the project's
 *  reject-deletes convention. Recomputes Contribution-by-Rep/Daily Projection inline
 *  so the import is reflected immediately rather than waiting for the next sync. */
export async function upsertRosterRows(rows: RosterUploadRow[]) {
  const teamLeaderNames = Array.from(new Set(rows.map((r) => r.teamLeaderName.trim())));
  const existing = await prisma.teamLeader.findMany({ where: { name: { in: teamLeaderNames } }, select: { id: true, name: true } });
  const teamLeaderByName = new Map(existing.map((tl) => [tl.name, tl.id]));
  for (const name of teamLeaderNames) {
    if (teamLeaderByName.has(name)) continue;
    const created = await prisma.teamLeader.create({ data: { name } });
    teamLeaderByName.set(name, created.id);
  }

  const withTeamLeaderId = rows.map((row) => ({ ...row, teamLeaderId: teamLeaderByName.get(row.teamLeaderName.trim())! }));
  for (let i = 0; i < withTeamLeaderId.length; i += CHUNK_SIZE) {
    await upsertAssignmentsChunk(withTeamLeaderId.slice(i, i + CHUNK_SIZE));
  }

  const contribution = await recomputeRepContribution();
  const daily = await recomputeDailyTargets();
  return { teamLeaders: teamLeaderNames.length, assignments: rows.length, contribution, daily };
}
