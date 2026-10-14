// The Mars employee roster (the "Mars Employee Roaster" file: name, code, group, region, location, Team Leader, seller type) as data and
// pure functions: reading it, deciding who is an active and who an inactive worker, and planning what changes in the system.
// scripts/mars-roster-2026-10.ts applies the plan to production inside one transaction (dry run first).
//
// Active and inactive: a rep is Active when they made at least one Mars sale in the last INACTIVE_AFTER_DAYS days (the same 90 days
// the Active Outlet module uses), and Inactive otherwise, with the reason and the date of the last sale. Test accounts are always
// Inactive. Sales are matched to a roster entry by name (the sales ledger has the rep's name, not their code); when one name holds
// two codes the sales go to the code that is already live in the roster.

import { MARS_PRINCIPAL, isValidMarsPlacement } from "./marsStructure";

export const INACTIVE_AFTER_DAYS = 90;

export interface RosterCsvRow {
  employeeName: string;
  employeeCode: string;
  employeeGroup: string;
  region: string;
  location: string;
  teamLeader: string;
  sellerType: string;
}

export interface ParsedRoster {
  rows: RosterCsvRow[];
  problems: string[];
}

/** Collapses runs of spaces and trims: "Alex  Kithure " is "Alex Kithure". */
export const cleanName = (value: string | null | undefined): string => (value ?? "").replace(/\s+/g, " ").trim();

export const nameKey = (value: string | null | undefined): string =>
  cleanName(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function splitLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

/** Reads the roster file. Required columns: Employee Name, Employee Code, Employee Group, Region, Location, Team Leader, Seller Type. */
export function parseMarsRosterCsv(text: string): ParsedRoster {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const problems: string[] = [];
  if (lines.length === 0) return { rows: [], problems: ["The file is empty."] };
  const header = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const need = ["Employee Name", "Employee Code", "Employee Group", "Region", "Location", "Team Leader", "Seller Type"];
  const missing = need.filter((name) => col(name) < 0);
  if (missing.length > 0) return { rows: [], problems: [`Missing column(s): ${missing.join(", ")}.`] };
  const rows: RosterCsvRow[] = [];
  const seen = new Set<string>();
  lines.slice(1).forEach((line, index) => {
    const c = splitLine(line);
    const get = (name: string) => cleanName(c[col(name)]);
    const row: RosterCsvRow = {
      employeeName: get("Employee Name"),
      employeeCode: get("Employee Code"),
      employeeGroup: get("Employee Group"),
      region: get("Region"),
      location: get("Location"),
      teamLeader: get("Team Leader"),
      sellerType: get("Seller Type"),
    };
    const where = `line ${index + 2} (${row.employeeName || "no name"})`;
    if (row.employeeCode === "") return void problems.push(`${where}: no employee code.`);
    if (seen.has(row.employeeCode)) return void problems.push(`${where}: employee code ${row.employeeCode} appears twice.`);
    seen.add(row.employeeCode);
    if (row.teamLeader === "") problems.push(`${where}: no Team Leader.`);
    if (!isValidMarsPlacement(row.region, row.location)) problems.push(`${where}: ${row.location} is not a sub-region of ${row.region}.`);
    rows.push(row);
  });
  return { rows, problems };
}

export interface RepActivity {
  name: string;
  /** Mars sales in the last 90 days, and the date of the latest Mars sale this year (null when none). */
  events90: number;
  lastSale: Date | null;
  /** Distinct days with a Mars sale in the last 90 days. */
  activeDays90: number;
}

export type RepStatus = "Active" | "Inactive";

export interface RepClassification {
  status: RepStatus;
  reason: string;
  lastSale: Date | null;
  activeDays: number;
}

const DAY = 86_400_000;
const isTestAccount = (row: RosterCsvRow) => /^test$/i.test(row.employeeGroup) || /^(test|fsr test)\b/i.test(row.employeeName);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** Active or Inactive for every roster row. `liveCodes` are the codes already live in the roster (they win a shared name). */
export function classifyReps(rows: RosterCsvRow[], activity: Map<string, RepActivity>, liveCodes: ReadonlySet<string>, asOf: Date, inactiveAfterDays = INACTIVE_AFTER_DAYS): Map<string, RepClassification> {
  const byName = new Map<string, RosterCsvRow[]>();
  for (const row of rows) {
    const key = nameKey(row.employeeName);
    const list = byName.get(key);
    if (list) list.push(row);
    else byName.set(key, [row]);
  }
  // For a name that holds several codes, the one that carries the sales.
  const carrier = new Map<string, string>();
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    const live = group.filter((row) => liveCodes.has(row.employeeCode));
    const pool = live.length > 0 ? live : group;
    carrier.set(key, pool.reduce((best, row) => (Number(row.employeeCode) > Number(best.employeeCode) ? row : best)).employeeCode);
  }
  const result = new Map<string, RepClassification>();
  for (const row of rows) {
    const key = nameKey(row.employeeName);
    const seen = activity.get(key);
    const base = { lastSale: seen?.lastSale ?? null, activeDays: seen?.activeDays90 ?? 0 };
    if (isTestAccount(row)) {
      result.set(row.employeeCode, { status: "Inactive", reason: "Test account", ...base });
      continue;
    }
    const holder = carrier.get(key);
    if (holder && holder !== row.employeeCode) {
      result.set(row.employeeCode, { status: "Inactive", reason: `Same name as code ${holder}, which carries the sales`, lastSale: null, activeDays: 0 });
      continue;
    }
    if (!seen || seen.lastSale === null) {
      result.set(row.employeeCode, { status: "Inactive", reason: "No Mars sale this year", ...base });
      continue;
    }
    const days = Math.floor((asOf.getTime() - seen.lastSale.getTime()) / DAY);
    if (days <= inactiveAfterDays && seen.events90 > 0) result.set(row.employeeCode, { status: "Active", reason: `Last Mars sale ${isoDate(seen.lastSale)}`, ...base });
    else result.set(row.employeeCode, { status: "Inactive", reason: `No Mars sale since ${isoDate(seen.lastSale)} (${days} days)`, ...base });
  }
  return result;
}

export interface ExistingAssignment {
  id: string;
  teamLeaderId: string;
  teamLeaderName: string;
  employeeCode: string;
  active: boolean;
  region: string | null;
  subRegion: string | null;
  workGroup: string | null;
}

export type AssignmentAction =
  | { kind: "create"; row: RosterCsvRow; status: RepStatus }
  | { kind: "update"; existing: ExistingAssignment; row: RosterCsvRow; status: RepStatus; moveTeamLeader: boolean; changes: string[] }
  | { kind: "none"; existing: ExistingAssignment; row: RosterCsvRow };

export interface RosterPlan {
  actions: AssignmentAction[];
  /** Roster reps that are active but have no assignment yet: they are added. Inactive reps with no assignment are not. */
  created: number;
  moved: number;
  activated: number;
  deactivated: number;
  regionChanged: number;
  /** Live assignments on Mars whose code is not in the roster file: left as they are. */
  notInFile: ExistingAssignment[];
}

/** What changes in the Mars assignments. Existing rows keep their data; the roster's Team Leader, region, sub-region and group are applied,
 *  and the row's active flag follows the rep's status. New rows are only added for active reps. */
export function planAssignments(rows: RosterCsvRow[], classes: Map<string, RepClassification>, existing: ExistingAssignment[]): RosterPlan {
  const byCode = new Map<string, ExistingAssignment[]>();
  for (const a of existing) {
    const list = byCode.get(a.employeeCode);
    if (list) list.push(a);
    else byCode.set(a.employeeCode, [a]);
  }
  const plan: RosterPlan = { actions: [], created: 0, moved: 0, activated: 0, deactivated: 0, regionChanged: 0, notInFile: [] };
  for (const row of rows) {
    const status = classes.get(row.employeeCode)?.status ?? "Inactive";
    const rowsForCode = byCode.get(row.employeeCode) ?? [];
    const own = rowsForCode.find((a) => a.active) ?? rowsForCode[0];
    if (!own) {
      if (status === "Active") {
        plan.actions.push({ kind: "create", row, status });
        plan.created += 1;
      }
      continue;
    }
    const changes: string[] = [];
    const moveTeamLeader = own.teamLeaderName !== row.teamLeader;
    if (moveTeamLeader) changes.push(`Team Leader ${own.teamLeaderName} -> ${row.teamLeader}`);
    if ((own.region ?? "") !== row.region || (own.subRegion ?? "") !== row.location) {
      changes.push(`${own.region ?? "-"}/${own.subRegion ?? "-"} -> ${row.region}/${row.location}`);
      plan.regionChanged += 1;
    }
    if ((own.workGroup ?? "") !== row.employeeGroup) changes.push(`group ${own.workGroup ?? "-"} -> ${row.employeeGroup}`);
    const wantsActive = status === "Active";
    if (own.active !== wantsActive) {
      changes.push(wantsActive ? "reactivated" : "made inactive");
      if (wantsActive) plan.activated += 1;
      else plan.deactivated += 1;
    }
    if (moveTeamLeader) plan.moved += 1;
    plan.actions.push(changes.length > 0 ? { kind: "update", existing: own, row, status, moveTeamLeader, changes } : { kind: "none", existing: own, row });
  }
  const inFile = new Set(rows.map((r) => r.employeeCode));
  plan.notInFile = existing.filter((a) => a.active && !inFile.has(a.employeeCode));
  return plan;
}

export { MARS_PRINCIPAL };
