// The Roster CSV in the 18-column shape the "Upload Roster (CSV)" form expects (see lib/rosterImport.ts), built from TeamLeaderAssignment rows.
// Shared by the full roster download (app/api/team-leaders/export-roster) and the upload example, so both always match the upload format.

export const ROSTER_EXPORT_HEADER = [
  "Employee Code", "Employee (Sales Edge Name)", "SAP Name", "Channel", "Team Leader", "Principal",
  "* Contribution %", "Sales Role", "Absolute Principal", "Work Group", "Region", "Sub Region",
  "Cost Center", "Sales Point", "Route", "Stock Point", "Sales Supervisor", "Manager",
] as const;

export interface RosterExportAssignment {
  employeeCode: string;
  employeeName: string;
  sapName: string | null;
  channel: string | null;
  teamLeaderId: string;
  principal: string;
  contributionPct: number | null;
  salesRole: string;
  absolutePrincipal: string | null;
  workGroup: string | null;
  region: string | null;
  subRegion: string | null;
  costCenter: string | null;
  salesPoint: string | null;
  route: string | null;
  stockPoint: string | null;
  supervisorId: string | null;
  managerId: string | null;
}

/** One row per assignment, in ROSTER_EXPORT_HEADER's column order; blanks are "". The contribution is written as a percentage ("25.00%"). */
export function rosterExportRows(
  assignments: RosterExportAssignment[],
  names: { teamLeaders: Map<string, string>; supervisors: Map<string, string>; managers: Map<string, string> }
): (string | number)[][] {
  return assignments.map((a) => [
    a.employeeCode,
    a.employeeName,
    a.sapName ?? "",
    a.channel ?? "",
    names.teamLeaders.get(a.teamLeaderId) ?? "",
    a.principal,
    a.contributionPct !== null ? `${(a.contributionPct * 100).toFixed(2)}%` : "",
    a.salesRole === "PRIMARY" ? "Primary" : "Secondary",
    a.absolutePrincipal ?? "",
    a.workGroup ?? "",
    a.region ?? "",
    a.subRegion ?? "",
    a.costCenter ?? "",
    a.salesPoint ?? "",
    a.route ?? "",
    a.stockPoint ?? "",
    a.supervisorId ? names.supervisors.get(a.supervisorId) ?? "" : "",
    a.managerId ? names.managers.get(a.managerId) ?? "" : "",
  ]);
}
