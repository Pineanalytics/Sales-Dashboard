import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same 18-column shape uploadRosterCsvAction's V18 path expects (see
// lib/rosterImport.ts's own header comment) — round-trips cleanly: export,
// edit in a spreadsheet, re-upload through the same "Upload Roster (CSV)"
// form. TeamLeaderAssignment already carries every one of these columns
// directly (this is exactly what a V18 import upserts into it), so this is a
// straight read, no EmployeeMaster join needed.
const HEADER = [
  "Employee Code", "Employee (Sales Edge Name)", "SAP Name", "Channel", "Team Leader", "Principal",
  "* Contribution %", "Sales Role", "Absolute Principal", "Work Group", "Region", "Sub Region",
  "Cost Center", "Sales Point", "Route", "Stock Point", "Sales Supervisor", "Manager",
] as const;

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "SUPERVISOR")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);

  const [assignments, teamLeaders, supervisors, managers] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      where: scope ? { teamLeaderId: { in: scope.teamLeaderIds } } : {},
      orderBy: [{ teamLeaderId: "asc" }, { principal: "asc" }, { employeeName: "asc" }],
    }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.supervisor.findMany({ select: { id: true, name: true } }),
    prisma.manager.findMany({ select: { id: true, name: true } }),
  ]);

  const teamLeaderName = new Map(teamLeaders.map((t) => [t.id, t.name]));
  const supervisorName = new Map(supervisors.map((s) => [s.id, s.name]));
  const managerName = new Map(managers.map((m) => [m.id, m.name]));

  const lines = [HEADER.join(",")];
  for (const a of assignments) {
    lines.push(
      [
        a.employeeCode,
        a.employeeName,
        a.sapName,
        a.channel,
        teamLeaderName.get(a.teamLeaderId) ?? "",
        a.principal,
        a.contributionPct !== null ? `${(a.contributionPct * 100).toFixed(2)}%` : "",
        a.salesRole === "PRIMARY" ? "Primary" : "Secondary",
        a.absolutePrincipal,
        a.workGroup,
        a.region,
        a.subRegion,
        a.costCenter,
        a.salesPoint,
        a.route,
        a.stockPoint,
        a.supervisorId ? supervisorName.get(a.supervisorId) ?? "" : "",
        a.managerId ? managerName.get(a.managerId) ?? "" : "",
      ]
        .map(csvEscape)
        .join(",")
    );
  }

  const filename = `roster-export-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
