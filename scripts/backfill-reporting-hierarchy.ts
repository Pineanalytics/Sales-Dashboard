import { prisma } from "../lib/db";
import { deriveReportingHierarchy } from "../lib/reportingHierarchy";

/**
 * One-time repair for deployments that already held V18 roster assignment
 * rows when TeamLeader.supervisorId and Supervisor.managerId were introduced.
 * It only fills blank direct links, so explicit admin edits always win.
 */
async function main() {
  const [assignments, teamLeaders, supervisors] = await Promise.all([
    prisma.teamLeaderAssignment.findMany({
      where: { active: true },
      select: { teamLeaderId: true, supervisorId: true, managerId: true, employeeCode: true, employeeName: true },
    }),
    prisma.teamLeader.findMany({ select: { id: true, supervisorId: true } }),
    prisma.supervisor.findMany({ select: { id: true, managerId: true } }),
  ]);

  const links = deriveReportingHierarchy(assignments);
  const blankTeamLeaderIds = new Set(teamLeaders.filter((teamLeader) => !teamLeader.supervisorId).map((teamLeader) => teamLeader.id));
  const blankSupervisorIds = new Set(supervisors.filter((supervisor) => !supervisor.managerId).map((supervisor) => supervisor.id));
  const teamLeaderUpdates = links.teamLeaderToSupervisor.filter((link) => blankTeamLeaderIds.has(link.teamLeaderId));
  const supervisorUpdates = links.supervisorToManager.filter((link) => blankSupervisorIds.has(link.supervisorId));

  await prisma.$transaction([
    ...teamLeaderUpdates.map((link) => prisma.teamLeader.update({ where: { id: link.teamLeaderId }, data: { supervisorId: link.supervisorId } })),
    ...supervisorUpdates.map((link) => prisma.supervisor.update({ where: { id: link.supervisorId }, data: { managerId: link.managerId } })),
  ]);

  console.log(`Backfilled ${teamLeaderUpdates.length} Team Leader → Sales Supervisor link(s) and ${supervisorUpdates.length} Sales Supervisor → Manager link(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
