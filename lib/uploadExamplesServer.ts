// Reads the data already in the dashboard and shapes it into each upload's example (see lib/uploadExamples.ts for the formats and the pure builders).
import { prisma } from "@/lib/db";
import { ROSTER_EXPORT_HEADER, rosterExportRows } from "@/lib/rosterExport";
import {
  leadershipExample,
  productsExample,
  sampleByGroup,
  targetsExample,
  upfieldOutletsExample,
  type ExampleTable,
  type LeadershipInput,
  type UploadKind,
} from "@/lib/uploadExamples";

/** The roster example is read through the caller's scope, like the roster download: a Supervisor sees only their own group's rows. */
export interface ExampleScope {
  teamLeaderIds: string[];
}

async function rosterExample(scope: ExampleScope | null): Promise<ExampleTable> {
  const [assignments, teamLeaders, supervisors, managers] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      where: { active: true, ...(scope ? { teamLeaderId: { in: scope.teamLeaderIds } } : {}) },
      orderBy: [{ principal: "asc" }, { employeeName: "asc" }],
    }),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
    prisma.supervisor.findMany({ select: { id: true, name: true } }),
    prisma.manager.findMany({ select: { id: true, name: true } }),
  ]);
  // Two reps from each of the six biggest principals, the ones with a contribution first (a row of zeros teaches little), shown in principal order.
  const ordered = [...assignments].sort((a, b) => (b.contributionPct ?? -1) - (a.contributionPct ?? -1) || a.employeeName.localeCompare(b.employeeName));
  const picked = sampleByGroup(ordered, (a) => a.principal, 2, 6).sort((a, b) => a.principal.localeCompare(b.principal) || a.employeeName.localeCompare(b.employeeName));
  return {
    columns: [...ROSTER_EXPORT_HEADER],
    rows: rosterExportRows(picked, {
      teamLeaders: new Map(teamLeaders.map((t) => [t.id, t.name])),
      supervisors: new Map(supervisors.map((s) => [s.id, s.name])),
      managers: new Map(managers.map((m) => [m.id, m.name])),
    }),
  };
}

async function leadershipRows(): Promise<LeadershipInput[]> {
  const [assignments, teamLeaders, supervisors, managers, hods] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { principal: true, teamLeaderId: true }, distinct: ["principal", "teamLeaderId"] }),
    prisma.teamLeader.findMany({ select: { id: true, name: true, email: true, supervisorId: true } }),
    prisma.supervisor.findMany({ select: { id: true, name: true, email: true, managerId: true, directHodId: true } }),
    prisma.manager.findMany({ select: { id: true, hodId: true } }),
    prisma.hod.findMany({ select: { id: true, name: true } }),
  ]);
  const teamLeaderById = new Map(teamLeaders.map((t) => [t.id, t]));
  const supervisorById = new Map(supervisors.map((s) => [s.id, s]));
  const hodIdByManager = new Map(managers.map((m) => [m.id, m.hodId]));
  const hodName = new Map(hods.map((h) => [h.id, h.name]));
  const rows: LeadershipInput[] = [];
  for (const assignment of assignments) {
    const teamLeader = teamLeaderById.get(assignment.teamLeaderId);
    const supervisor = teamLeader?.supervisorId ? supervisorById.get(teamLeader.supervisorId) : undefined;
    if (!teamLeader || !supervisor) continue;
    const hodId = supervisor.directHodId ?? (supervisor.managerId ? hodIdByManager.get(supervisor.managerId) : null);
    const head = hodId ? hodName.get(hodId) : undefined;
    if (!head) continue;
    rows.push({ principal: assignment.principal, supervisor: supervisor.name, supervisorEmail: supervisor.email, teamLeader: teamLeader.name, teamLeaderEmail: teamLeader.email, headOfSales: head });
  }
  return rows;
}

/** The example for one upload: real rows in the upload's own format. An empty table means the dashboard has nothing of that kind yet. */
export async function loadExampleTable(kind: UploadKind, scope: ExampleScope | null = null): Promise<ExampleTable> {
  switch (kind) {
    case "products":
      return productsExample(await prisma.product.findMany());
    case "targets":
      return targetsExample(await prisma.target.findMany({ orderBy: [{ year: "desc" }, { monthIndex: "desc" }], take: 400 }));
    case "roster":
      return rosterExample(scope);
    case "sales-leadership":
      return leadershipExample(await leadershipRows());
    case "upfield-outlets":
      return upfieldOutletsExample(await prisma.upfieldOutletMaster.findMany());
  }
}
