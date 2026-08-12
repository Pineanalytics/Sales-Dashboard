// Shared Roster-import logic. Two source shapes exist side by side:
//   V21 — Target_Management_System.xlsm's "Roster" sheet (Team Leader x Employee x
//         Principal, 21 columns incl. Active (Y/N)/Company/Cost Center Count/Location/
//         Source Contribution %). Still the shape scripts/target-management/import.ts's
//         .xlsm path produces — unchanged, not going away.
//   V18 — the 2026-08 Roster refresh (F:\Raw Reports\Employee roaster.csv), the first
//         export to carry real "Sales Supervisor"/"Manager"/"Stock Point" columns and a
//         genuine Primary/Secondary Sales Role split. Missing the 5 V21-only columns
//         above (Active/Company/Cost Center Count/Location/Source Contribution %) — a
//         V18 import must NOT null those out on a row a V21 import previously populated,
//         so the two formats get different ON CONFLICT DO UPDATE SET clauses (see
//         upsertAssignmentsChunk) rather than one shared clause.
// Reused by two entry points that both need the same parse + upsert behavior:
// scripts/target-management/import.ts (xlsm, posted over HTTPS to production) and
// app/(protected)/admin/team-leaders/actions.ts's uploadRosterCsvAction (a plain CSV
// export, uploaded directly through the browser — no local script run required).
// app/api/team-leaders/upload/route.ts is the API-key-gated HTTP entry point the
// script posts to; it also calls upsertRosterRows directly.
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

export type RosterFormat = "V21" | "V18";

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
  supervisor: string | null; // legacy free-text column, superseded by supervisorName below
  costCenterCount: number | null;
  salesPoint: string | null;
  route: string | null;
  location: string | null;
  sourceContributionPct: number | null;
  // V18-only (null on a V21 import):
  stockPoint: string | null;
  supervisorName: string | null; // Roster's "Sales Supervisor" column -> resolved to Supervisor.id on upsert
  managerName: string | null; // Roster's "Manager" column -> resolved to Manager.id on upsert
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

/** A genuine Excel/.xlsm workbook with a Percentage-formatted cell already
 *  comes through XLSX.sheet_to_json as a plain fraction (0.41) - cell format
 *  metadata survives the binary format, so nullableNumber alone is enough
 *  there. A CSV has no such metadata: if the source spreadsheet's column was
 *  ever formatted as Percentage before being saved to CSV, the cell's TEXT
 *  content is the literal "41%" - nullableNumber("41%") is Number("41%") ->
 *  NaN -> silently treated as "not declared," nulling out a rep's real
 *  contribution (confirmed live: the 2026-08 Roster refresh had nearly every
 *  "* Contribution %"/"Source Contribution %" value formatted this way,
 *  wiping out contributionPct for ~90% of the roster on import). Strip a
 *  trailing "%" and divide by 100 when present; a plain numeric string or
 *  number (already a fraction, either format) passes through unchanged. */
function nullablePercent(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = text(value);
  if (trimmed === "") return null;
  const isPercentString = trimmed.endsWith("%");
  const n = Number(isPercentString ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(n)) return null;
  return isPercentString ? n / 100 : n;
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

/** Detects which of the two Roster shapes a header row is — "Sales Supervisor" is
 *  V18-only, "Active (Y/N)" is V21-only. Throws rather than guessing on an
 *  unrecognized/ambiguous header row (e.g. a hand-edited export missing both). */
export function detectRosterFormat(headerRow: unknown[]): RosterFormat {
  const headers = new Set(headerRow.map((h) => text(h)));
  const hasV18Marker = headers.has("Sales Supervisor");
  const hasV21Marker = headers.has("Active (Y/N)");
  if (hasV18Marker && !hasV21Marker) return "V18";
  if (hasV21Marker && !hasV18Marker) return "V21";
  throw new RosterParseError(
    'Could not tell which Roster format this is — expected either an "Active (Y/N)" column (older 21-column export) or a "Sales Supervisor" column (2026-08+ export), not both or neither.'
  );
}

/** Maps already-read sheet rows (SheetJS's sheet_to_json output) into upload rows.
 *  rowNumberOffset accounts for however many header/banner rows precede the data in
 *  the caller's own source (e.g. +4 for the xlsm's 2-row banner + header row + 1-index,
 *  +2 for a plain CSV export with just its own header row). */
export function parseRosterSourceRows(source: SourceRow[], rowNumberOffset: number, format: RosterFormat): RosterUploadRow[] {
  return source
    .filter((row) => text(row["Employee Code"]) !== "")
    .map((row, index) => {
      const rowNumber = index + rowNumberOffset;
      const shared = {
        employeeCode: requiredText(row, "Employee Code", rowNumber),
        employeeName: requiredText(row, "Employee (Sales Edge Name)", rowNumber),
        sapName: nullableText(row["SAP Name"]),
        channel: nullableText(row.Channel),
        teamLeaderName: requiredText(row, "Team Leader", rowNumber),
        principal: requiredText(row, "Principal", rowNumber),
        contributionPct: nullablePercent(row["* Contribution %"]),
        salesRole: salesRoleValue(row["Sales Role"], rowNumber),
        absolutePrincipal: nullableText(row["Absolute Principal"]),
        workGroup: nullableText(row["Work Group"]),
        region: nullableText(row.Region),
        subRegion: nullableText(row["Sub Region"]),
        costCenter: nullableText(row["Cost Center"]),
        salesPoint: nullableText(row["Sales Point"]),
        route: nullableText(row.Route),
      };

      if (format === "V18") {
        return {
          ...shared,
          active: true, // no column in V18 — matches the DB default; deactivation stays a UI-only action
          company: null,
          costCenterCount: null,
          location: null,
          sourceContributionPct: null,
          supervisor: null, // legacy column — V18 populates supervisorName instead
          stockPoint: nullableText(row["Stock Point"]),
          supervisorName: nullableText(row["Sales Supervisor"]),
          managerName: nullableText(row.Manager),
        };
      }

      return {
        ...shared,
        active: activeFlag(row["Active (Y/N)"], rowNumber),
        company: nullableText(row.Company),
        costCenterCount: nullableInt(row["Cost Center Count"]),
        location: nullableText(row.Location),
        sourceContributionPct: nullablePercent(row["Source Contribution %"]),
        supervisor: nullableText(row.Supervisor),
        stockPoint: null,
        supervisorName: null,
        managerName: null,
      };
    });
}

/** Parses a plain CSV export of the Roster sheet (either format — see file header),
 *  a single header row (no 2-row instructions banner like the source .xlsm carries). */
export function parseRosterCsv(buffer: Buffer): { rows: RosterUploadRow[]; format: RosterFormat } {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new RosterParseError("The uploaded file has no readable sheet.");
  const sheet = workbook.Sheets[sheetName];
  const headerRow = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, range: 0 })[0] ?? [];
  const format = detectRosterFormat(headerRow);
  const source = XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true, range: 0 });
  const rows = parseRosterSourceRows(source, 2, format); // +1 header row, +1 for 1-indexing
  if (rows.length === 0) throw new RosterParseError('No data rows found — check the file has an "Employee Code" column with values.');
  return { rows, format };
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
    isNullableNumber(row.sourceContributionPct) &&
    isNullableText(row.stockPoint) &&
    isNullableText(row.supervisorName) &&
    isNullableText(row.managerName)
  );
}

const CHUNK_SIZE = 500;

type AssignmentRowWithIds = RosterUploadRow & { teamLeaderId: string; supervisorId: string | null; managerId: string | null };

async function upsertAssignmentsChunk(rows: AssignmentRowWithIds[], format: RosterFormat) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.teamLeaderId}, ${row.employeeCode}, ${row.employeeName}, ${row.principal}, ${row.channel}, ${row.sapName}, ${row.contributionPct}, ${row.active}, ${row.salesRole}, ${row.region}, ${row.subRegion}, ${row.supervisor}, ${row.workGroup}, ${row.company}, ${row.costCenter}, ${row.absolutePrincipal}, ${row.costCenterCount}, ${row.salesPoint}, ${row.route}, ${row.location}, ${row.sourceContributionPct}, ${row.supervisorId}, ${row.managerId}, ${row.stockPoint}, now(), now())`
  );

  // V18 has no Active/Company/Cost Center Count/Location/Source Contribution % columns
  // — re-importing a V18 CSV must not null out values a prior V21 (.xlsm) import set.
  // V21 has no Sales Supervisor/Manager/Stock Point columns — same protection, mirrored.
  const v21OnlySet = format === "V18"
    ? Prisma.empty
    : Prisma.sql`
      active = EXCLUDED.active,
      company = EXCLUDED.company,
      "costCenterCount" = EXCLUDED."costCenterCount",
      location = EXCLUDED.location,
      "sourceContributionPct" = EXCLUDED."sourceContributionPct",`;
  const v18OnlySet = format === "V21"
    ? Prisma.empty
    : Prisma.sql`
      "supervisorId" = EXCLUDED."supervisorId",
      "managerId" = EXCLUDED."managerId",
      "stockPoint" = EXCLUDED."stockPoint",`;

  await prisma.$executeRaw`
    INSERT INTO "TeamLeaderAssignment"
      (id, "teamLeaderId", "employeeCode", "employeeName", principal, channel, "sapName", "contributionPct", active, "salesRole", region, "subRegion", supervisor, "workGroup", company, "costCenter", "absolutePrincipal", "costCenterCount", "salesPoint", route, location, "sourceContributionPct", "supervisorId", "managerId", "stockPoint", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("teamLeaderId", "employeeCode", principal)
    DO UPDATE SET
      "employeeName" = EXCLUDED."employeeName",
      channel = EXCLUDED.channel,
      "sapName" = EXCLUDED."sapName",
      "contributionPct" = EXCLUDED."contributionPct",
      "salesRole" = EXCLUDED."salesRole",
      region = EXCLUDED.region,
      "subRegion" = EXCLUDED."subRegion",
      supervisor = EXCLUDED.supervisor,
      "workGroup" = EXCLUDED."workGroup",
      "costCenter" = EXCLUDED."costCenter",
      "absolutePrincipal" = EXCLUDED."absolutePrincipal",
      "salesPoint" = EXCLUDED."salesPoint",
      route = EXCLUDED.route,
      ${v21OnlySet}
      ${v18OnlySet}
      "updatedAt" = now()
  `;
}

/** A real Employee Code differs from the row's own Employee Name; a known
 *  placeholder-import artifact repeats the name in both fields (an
 *  unresolved SAP rep auto-created with its own name standing in for a real
 *  code). Confirmed live: Erick's own roster rows split exactly on this line,
 *  disagreeing about his Manager — weightedMajority below weights these rows
 *  double rather than discarding uncoded rows outright, in case a Team
 *  Leader/Principal has no coded rows at all yet. */
function isRealEmployeeCode(row: RosterUploadRow): boolean {
  return row.employeeCode.trim() !== row.employeeName.trim();
}

/** Weighted-majority vote of pick(row) per keyOf(row), skipping rows where
 *  pick(row) is null/blank — see isRealEmployeeCode for the weighting. Used
 *  to derive a single representative value (e.g. "which Manager does this
 *  Team Leader report to") from a batch of per-rep roster rows that don't
 *  always agree. */
function weightedMajority(rows: RosterUploadRow[], keyOf: (row: RosterUploadRow) => string, pick: (row: RosterUploadRow) => string | null): Map<string, string> {
  const votesByKey = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const value = pick(row)?.trim();
    const key = keyOf(row).trim();
    if (!value || !key) continue;
    const votes = votesByKey.get(key) ?? new Map<string, number>();
    const weight = isRealEmployeeCode(row) ? 2 : 1;
    votes.set(value, (votes.get(value) ?? 0) + weight);
    votesByKey.set(key, votes);
  }
  const winners = new Map<string, string>();
  for (const [key, votes] of votesByKey) {
    const [bestValue] = Array.from(votes.entries()).sort((a, b) => b[1] - a[1])[0];
    winners.set(key, bestValue);
  }
  return winners;
}

/** Upserts TeamLeader/Supervisor/Manager (find-or-create by name) then
 *  TeamLeaderAssignment rows on (teamLeaderId, employeeCode, principal) — the same
 *  unique key the admin UI's createAssignmentAction already uses. A row missing from
 *  a new export is left untouched (no auto-deactivation) — matches the project's
 *  reject-deletes convention. Recomputes Contribution-by-Rep/Daily Projection inline
 *  so the import is reflected immediately rather than waiting for the next sync.
 *
 *  Also refreshes TeamLeader.supervisorId / Supervisor.managerId (V18 only —
 *  V21 has no Sales Supervisor/Manager columns) and Principal.teamLeaderId
 *  (both formats) from this same import, via weightedMajority above. These are
 *  HR facts about the Team Leader/Supervisor/Principal, not about any one rep
 *  row — lib/tlRanking.ts's buildSupervisorRanking/buildManagerRanking used to
 *  read the reporting line from TeamLeaderAssignment rows directly and picked
 *  arbitrarily whenever a Team Leader's own rows disagreed (confirmed live for
 *  Erick). Never creates a new Principal row from a roster row (which lacks
 *  location/status/mainPrincipal) — only updates one that already exists via
 *  app/(protected)/admin/principals. */
export async function upsertRosterRows(rows: RosterUploadRow[], format: RosterFormat = "V21") {
  const teamLeaderNames = Array.from(new Set(rows.map((r) => r.teamLeaderName.trim())));
  const existingTls = await prisma.teamLeader.findMany({ where: { name: { in: teamLeaderNames } }, select: { id: true, name: true } });
  const teamLeaderByName = new Map(existingTls.map((tl) => [tl.name, tl.id]));
  for (const name of teamLeaderNames) {
    if (teamLeaderByName.has(name)) continue;
    const created = await prisma.teamLeader.create({ data: { name } });
    teamLeaderByName.set(name, created.id);
  }

  const supervisorNames = Array.from(new Set(rows.map((r) => r.supervisorName?.trim()).filter((n): n is string => !!n)));
  const existingSupervisors = await prisma.supervisor.findMany({ where: { name: { in: supervisorNames } }, select: { id: true, name: true } });
  const supervisorByName = new Map(existingSupervisors.map((s) => [s.name, s.id]));
  for (const name of supervisorNames) {
    if (supervisorByName.has(name)) continue;
    const created = await prisma.supervisor.create({ data: { name } });
    supervisorByName.set(name, created.id);
  }

  const managerNames = Array.from(new Set(rows.map((r) => r.managerName?.trim()).filter((n): n is string => !!n)));
  const existingManagers = await prisma.manager.findMany({ where: { name: { in: managerNames } }, select: { id: true, name: true } });
  const managerByName = new Map(existingManagers.map((m) => [m.name, m.id]));
  for (const name of managerNames) {
    if (managerByName.has(name)) continue;
    const created = await prisma.manager.create({ data: { name } });
    managerByName.set(name, created.id);
  }

  const withIds: AssignmentRowWithIds[] = rows.map((row) => ({
    ...row,
    teamLeaderId: teamLeaderByName.get(row.teamLeaderName.trim())!,
    supervisorId: row.supervisorName ? (supervisorByName.get(row.supervisorName.trim()) ?? null) : null,
    managerId: row.managerName ? (managerByName.get(row.managerName.trim()) ?? null) : null,
  }));
  for (let i = 0; i < withIds.length; i += CHUNK_SIZE) {
    await upsertAssignmentsChunk(withIds.slice(i, i + CHUNK_SIZE), format);
  }

  let reportingLineUpdates = 0;
  if (format === "V18") {
    const tlToSupervisorName = weightedMajority(rows, (r) => r.teamLeaderName, (r) => r.supervisorName);
    for (const [tlName, supervisorName] of tlToSupervisorName) {
      const teamLeaderId = teamLeaderByName.get(tlName);
      const supervisorId = supervisorByName.get(supervisorName);
      if (teamLeaderId && supervisorId) {
        await prisma.teamLeader.update({ where: { id: teamLeaderId }, data: { supervisorId } });
        reportingLineUpdates++;
      }
    }

    const supervisorToManagerName = weightedMajority(rows.filter((r) => r.supervisorName), (r) => r.supervisorName!, (r) => r.managerName);
    for (const [supName, managerName] of supervisorToManagerName) {
      const supervisorId = supervisorByName.get(supName);
      const managerId = managerByName.get(managerName);
      if (supervisorId && managerId) {
        await prisma.supervisor.update({ where: { id: supervisorId }, data: { managerId } });
        reportingLineUpdates++;
      }
    }
  }

  const principalToTeamLeaderName = weightedMajority(rows, (r) => r.principal, (r) => r.teamLeaderName);
  const existingPrincipals = await prisma.principal.findMany({
    where: { principal: { in: Array.from(principalToTeamLeaderName.keys()) } },
    select: { principal: true, teamLeaderId: true },
  });
  const principalByName = new Map(existingPrincipals.map((p) => [p.principal, p]));
  let principalOwnershipUpdates = 0;
  for (const [principalName, tlName] of principalToTeamLeaderName) {
    const existing = principalByName.get(principalName);
    if (!existing) continue; // not an admin-managed Principal yet — leave for /admin/principals
    const teamLeaderId = teamLeaderByName.get(tlName);
    if (teamLeaderId && teamLeaderId !== existing.teamLeaderId) {
      await prisma.principal.update({ where: { principal: principalName }, data: { teamLeaderId } });
      principalOwnershipUpdates++;
    }
  }

  // Also refresh EmployeeMaster from this same CSV import (V18 only — it's the
  // only format carrying every column EmployeeMaster needs: Absolute
  // Principal, Sales Role, Team Leader name, etc.). Closes the drift between
  // this roster path and the separate .xlsx-fed EmployeeMaster path
  // (scripts/employee-master/import.ts) — an employee onboarded through
  // either file now ends up correctly resolvable for Timestamps
  // (lib/timestampSummary.ts, which reads EmployeeMaster directly and, until
  // now, only that path). Skips a row with no Absolute Principal —
  // EmployeeMaster.absolutePrincipal is required, and guessing one would be
  // worse than leaving the gap for an admin to fill via
  // /admin/employee-master.
  let employeeMasterUpserts = 0;
  if (format === "V18") {
    const byEmployeeCode = new Map<string, RosterUploadRow>();
    for (const row of rows) {
      if (!byEmployeeCode.has(row.employeeCode)) byEmployeeCode.set(row.employeeCode, row);
    }
    for (const row of byEmployeeCode.values()) {
      const absolutePrincipal = row.absolutePrincipal?.trim();
      if (!absolutePrincipal) continue;
      await prisma.employeeMaster.upsert({
        where: { employeeCode: row.employeeCode },
        create: {
          employeeCode: row.employeeCode,
          company: row.company,
          pineName: row.employeeName,
          sapName: row.sapName || row.employeeName,
          absolutePrincipal,
          salesRole: row.salesRole === "PRIMARY" ? "Primary Sales" : "Secondary Sales",
          workGroup: row.workGroup,
          region: row.region,
          subRegion: row.subRegion,
          teamLeader: row.teamLeaderName || null,
          supervisor: row.supervisorName,
          active: true,
          costCenterCount: row.costCenterCount,
          salesPoint: row.salesPoint,
          route: row.route,
          location: row.location,
        },
        update: {
          pineName: row.employeeName,
          sapName: row.sapName || row.employeeName,
          absolutePrincipal,
          salesRole: row.salesRole === "PRIMARY" ? "Primary Sales" : "Secondary Sales",
          workGroup: row.workGroup,
          region: row.region,
          subRegion: row.subRegion,
          teamLeader: row.teamLeaderName || null,
          supervisor: row.supervisorName,
          costCenterCount: row.costCenterCount,
          salesPoint: row.salesPoint,
          route: row.route,
          location: row.location,
          // active intentionally left alone on update — V18 carries no
          // Active/Inactive column at all (see the RosterFormat header
          // comment), so re-importing must never undo an admin's manual
          // deactivation via /admin/employee-master's own toggle.
        },
      });
      employeeMasterUpserts++;
    }
  }

  const contribution = await recomputeRepContribution();
  const daily = await recomputeDailyTargets();
  return {
    teamLeaders: teamLeaderNames.length,
    supervisors: supervisorNames.length,
    managers: managerNames.length,
    assignments: rows.length,
    reportingLineUpdates,
    principalOwnershipUpdates,
    employeeMasterUpserts,
    contribution,
    daily,
  };
}
