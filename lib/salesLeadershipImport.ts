// Sales Leadership org-chart CSV — Principal x Sales Supervisor x Team
// Leader x Head of Sales, one row per (Principal, Team Leader). A different
// shape from the rep-roster CSV (lib/rosterImport.ts): no Employee Code or
// rep data at all, and it introduces the Head of Sales tier the roster CSV
// doesn't carry. Establishes/corrects the org chart (Supervisor.directHodId,
// TeamLeader.supervisorId, Principal.supervisorId/teamLeaderId) and, for a
// Principal with exactly one Team Leader in the file, grants that Team
// Leader real dashboard visibility via lib/rosterAssignment.ts's
// assignPrincipalRepsToTeamLeader — the same mechanism
// admin/team-leaders/actions.ts's single-Principal bulk action uses.
//
// A Principal appearing under more than one Team Leader in the file (e.g.
// Mars-Nairobi, split across three) has no rep-level split information here
// — running the bulk rep grant for each of its Team Leaders in turn would
// incorrectly hand every one of that Principal's reps to all of them. Its
// TeamLeaderAssignment rows are left untouched; only a rep-roster import (or
// per-rep assignment on /admin/team-leaders) can determine that real split.
// Its Team Leader entities and their Supervisor reporting line are still
// created/corrected — only the rep-level grant is skipped.
//
// Every Sales Supervisor in this file reports directly to its Head of Sales
// (Supervisor.directHodId) — the file carries no Manager column, so
// managerId is cleared for every Supervisor named here ("Direct assignment"
// — see prisma/schema.prisma's Supervisor.directHodId comment). "Sales
// Supervisors without Team Leaders under them are self-represented" needs no
// special-casing: when a row's Sales Supervisor and Team Leader names match
// (e.g. "Emmy"/"Emmy"), the normal find-or-create logic below already
// creates both a Supervisor and a Team Leader row for that name and links
// them — a person naturally appearing in both tables.
//
// Unlike lib/rosterImport.ts's upsertRosterRows (which deliberately never
// creates a Principal row — a roster row lacks location/status data), this
// importer DOES create one when missing, since this file is explicitly the
// source of truth for a brand-new Principal's leadership (e.g. Bidco).
//
// The Sales Supervisor/Team Leader/Head of Sales Email columns are parsed
// but currently unused — linking a login (User.teamLeaderId/supervisorId) to
// an org entity is handled separately via /admin/users, matching how
// upsertRosterRows also never touches User.
import * as XLSX from "xlsx";
import { prisma } from "./db";
import { assignPrincipalRepsToTeamLeader, recomputeRosterDerived, type AssignPrincipalResult } from "./rosterAssignment";

export interface SalesLeadershipRow {
  principal: string;
  supervisorName: string;
  teamLeaderName: string;
  hodName: string;
}

type SourceRow = Record<string, unknown>;

export class SalesLeadershipParseError extends Error {}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function requiredText(row: SourceRow, column: string, rowNumber: number): string {
  const value = text(row[column]);
  if (!value) throw new SalesLeadershipParseError(`Missing "${column}" on row ${rowNumber}.`);
  return value;
}

export function parseSalesLeadershipSourceRows(source: SourceRow[], rowNumberOffset: number): SalesLeadershipRow[] {
  return source
    .filter((row) => text(row.Principal) !== "")
    .map((row, index) => {
      const rowNumber = index + rowNumberOffset;
      return {
        principal: requiredText(row, "Principal", rowNumber),
        supervisorName: requiredText(row, "Sales Supervisor", rowNumber),
        teamLeaderName: requiredText(row, "Team Leader", rowNumber),
        hodName: requiredText(row, "Head Of Sales", rowNumber),
      };
    });
}

/** Parses a plain CSV export — a single header row (Principal, Sales
 *  Supervisor, Sales Supervisor Email, Team Leader, Team Leader Email, Head
 *  Of Sales, Head Of Sales Email). */
export function parseSalesLeadershipCsv(buffer: Buffer): SalesLeadershipRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new SalesLeadershipParseError("The uploaded file has no readable sheet.");
  const sheet = workbook.Sheets[sheetName];
  const source = XLSX.utils.sheet_to_json<SourceRow>(sheet, { defval: null, raw: true, range: 0 });
  const rows = parseSalesLeadershipSourceRows(source, 2); // +1 header row, +1 for 1-indexing
  if (rows.length === 0) throw new SalesLeadershipParseError('No data rows found — check the file has a "Principal" column with values.');
  return rows;
}

/** Splits "Bic-Nairobi" -> { mainPrincipal: "Bic", location: "Nairobi" },
 *  "Ukl-Intl-Nairobi" -> { mainPrincipal: "Ukl-Intl", location: "Nairobi"} —
 *  every Principal name in this codebase follows "<Brand>-<Location>", split
 *  on the LAST hyphen so a hyphenated brand name (Ukl-Intl) stays intact. */
export function splitPrincipalName(principal: string): { mainPrincipal: string; location: string } {
  const lastDash = principal.lastIndexOf("-");
  if (lastDash <= 0 || lastDash === principal.length - 1) {
    return { mainPrincipal: principal, location: principal };
  }
  return { mainPrincipal: principal.slice(0, lastDash), location: principal.slice(lastDash + 1) };
}

export interface SalesLeadershipImportResult {
  hods: number;
  supervisors: number;
  teamLeaders: number;
  principalsCreated: number;
  principalOwnershipUpdates: number;
  assignments: ({ principal: string; teamLeaderId: string } & AssignPrincipalResult)[];
  /** Left untouched at the rep level — see file header comment. */
  multiTeamLeaderPrincipals: string[];
}

export async function upsertSalesLeadership(rows: SalesLeadershipRow[], userEmail: string): Promise<SalesLeadershipImportResult> {
  const hodNames = Array.from(new Set(rows.map((r) => r.hodName.trim())));
  const existingHods = await prisma.hod.findMany({ where: { name: { in: hodNames } }, select: { id: true, name: true } });
  const hodByName = new Map(existingHods.map((h) => [h.name, h.id]));
  for (const name of hodNames) {
    if (hodByName.has(name)) continue;
    const created = await prisma.hod.create({ data: { name } });
    hodByName.set(name, created.id);
  }

  const supervisorNames = Array.from(new Set(rows.map((r) => r.supervisorName.trim())));
  const existingSupervisors = await prisma.supervisor.findMany({ where: { name: { in: supervisorNames } }, select: { id: true, name: true } });
  const supervisorByName = new Map(existingSupervisors.map((s) => [s.name, s.id]));
  for (const name of supervisorNames) {
    if (supervisorByName.has(name)) continue;
    const created = await prisma.supervisor.create({ data: { name } });
    supervisorByName.set(name, created.id);
  }
  const supervisorToHodName = new Map(rows.map((r) => [r.supervisorName.trim(), r.hodName.trim()]));
  for (const [supName, hodName] of supervisorToHodName) {
    const supervisorId = supervisorByName.get(supName);
    const directHodId = hodByName.get(hodName);
    if (supervisorId && directHodId) {
      await prisma.supervisor.update({ where: { id: supervisorId }, data: { directHodId, managerId: null } });
    }
  }

  const teamLeaderNames = Array.from(new Set(rows.map((r) => r.teamLeaderName.trim())));
  const existingTls = await prisma.teamLeader.findMany({ where: { name: { in: teamLeaderNames } }, select: { id: true, name: true } });
  const teamLeaderByName = new Map(existingTls.map((tl) => [tl.name, tl.id]));
  for (const name of teamLeaderNames) {
    if (teamLeaderByName.has(name)) continue;
    const created = await prisma.teamLeader.create({ data: { name } });
    teamLeaderByName.set(name, created.id);
  }
  const teamLeaderToSupervisorName = new Map(rows.map((r) => [r.teamLeaderName.trim(), r.supervisorName.trim()]));
  for (const [tlName, supName] of teamLeaderToSupervisorName) {
    const teamLeaderId = teamLeaderByName.get(tlName);
    const supervisorId = supervisorByName.get(supName);
    if (teamLeaderId && supervisorId) {
      await prisma.teamLeader.update({ where: { id: teamLeaderId }, data: { supervisorId } });
    }
  }

  const principalNames = Array.from(new Set(rows.map((r) => r.principal.trim())));
  const existingPrincipals = await prisma.principal.findMany({
    where: { principal: { in: principalNames } },
    select: { principal: true, teamLeaderId: true },
  });
  const principalRowByName = new Map(existingPrincipals.map((p) => [p.principal, p]));

  const teamLeadersByPrincipal = new Map<string, Set<string>>();
  for (const row of rows) {
    const principal = row.principal.trim();
    const set = teamLeadersByPrincipal.get(principal) ?? new Set<string>();
    set.add(row.teamLeaderName.trim());
    teamLeadersByPrincipal.set(principal, set);
  }

  let principalsCreated = 0;
  let principalOwnershipUpdates = 0;
  const assignments: SalesLeadershipImportResult["assignments"] = [];
  const multiTeamLeaderPrincipals: string[] = [];

  for (const principal of principalNames) {
    const supervisorName = rows.find((r) => r.principal.trim() === principal)!.supervisorName.trim();
    const supervisorId = supervisorByName.get(supervisorName) ?? null;
    const distinctTeamLeaders = Array.from(teamLeadersByPrincipal.get(principal) ?? []);
    // Principal.teamLeaderId is single-valued ranking credit — only set it
    // when this file names exactly one Team Leader for the Principal, never
    // a guess between several.
    const singleTeamLeaderId = distinctTeamLeaders.length === 1 ? (teamLeaderByName.get(distinctTeamLeaders[0]) ?? null) : null;

    const existing = principalRowByName.get(principal);
    if (!existing) {
      const { mainPrincipal, location } = splitPrincipalName(principal);
      await prisma.principal.create({
        data: { principal, mainPrincipal, location, supervisorId, teamLeaderId: singleTeamLeaderId },
      });
      principalsCreated++;
    } else {
      const data: { supervisorId?: string | null; teamLeaderId?: string } = {};
      if (supervisorId) data.supervisorId = supervisorId;
      if (singleTeamLeaderId && singleTeamLeaderId !== existing.teamLeaderId) data.teamLeaderId = singleTeamLeaderId;
      if (Object.keys(data).length > 0) {
        await prisma.principal.update({ where: { principal }, data });
        principalOwnershipUpdates++;
      }
    }

    if (distinctTeamLeaders.length > 1) {
      multiTeamLeaderPrincipals.push(principal);
      continue;
    }
    if (singleTeamLeaderId) {
      const result = await assignPrincipalRepsToTeamLeader(singleTeamLeaderId, principal, supervisorId, userEmail);
      assignments.push({ principal, teamLeaderId: singleTeamLeaderId, ...result });
    }
  }

  await recomputeRosterDerived();

  return {
    hods: hodNames.length,
    supervisors: supervisorNames.length,
    teamLeaders: teamLeaderNames.length,
    principalsCreated,
    principalOwnershipUpdates,
    assignments,
    multiTeamLeaderPrincipals,
  };
}
