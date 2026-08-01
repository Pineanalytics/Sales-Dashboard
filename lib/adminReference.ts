// Shared canonical lookup values for the admin entry forms. Employee Roaster is
// the source of truth when it is present; historical JP/Rep Call/Target data only
// supplements it so an older record never vanishes from an admin lookup.
import { prisma } from "./db";

export interface KnownRep {
  employeeCode: string;
  employeeName: string;
}

export async function getKnownPrincipals(): Promise<string[]> {
  const [targetPrincipals, masterPrincipals, contributionPrincipals] = await Promise.all([
    prisma.target.findMany({ select: { principal: true }, distinct: ["principal"] }),
    prisma.employeeMaster.findMany({ where: { active: true }, select: { absolutePrincipal: true }, distinct: ["absolutePrincipal"] }),
    prisma.employeePrincipalContribution.findMany({ select: { principal: true }, distinct: ["principal"] }),
  ]);
  return Array.from(
    new Set([
      ...masterPrincipals.map((p) => p.absolutePrincipal),
      ...contributionPrincipals.map((p) => p.principal),
      ...targetPrincipals.map((p) => p.principal),
    ])
  ).sort();
}

export async function getKnownMainPrincipals(): Promise<string[]> {
  const rows = await prisma.target.findMany({ select: { mainPrincipal: true }, distinct: ["mainPrincipal"] });
  return Array.from(new Set(rows.map((r) => r.mainPrincipal).filter((v): v is string => !!v))).sort();
}

export async function getKnownReps(): Promise<KnownRep[]> {
  const [masterReps, jpReps, repCallReps, rosterReps] = await Promise.all([
    prisma.employeeMaster.findMany({ where: { active: true }, select: { employeeCode: true, pineName: true } }),
    prisma.journeyPlanRow.findMany({ select: { employeeCode: true, employeeName: true }, distinct: ["employeeCode"], take: 2000 }),
    prisma.repCall.findMany({ select: { employeeCode: true, salesRep: true }, distinct: ["employeeCode"], take: 2000 }),
    prisma.teamLeaderAssignment.findMany({ where: { active: true }, select: { employeeCode: true, employeeName: true }, distinct: ["employeeCode"] }),
  ]);
  const repsByCode = new Map<string, string>();
  for (const r of repCallReps) repsByCode.set(r.employeeCode, r.salesRep);
  for (const r of jpReps) repsByCode.set(r.employeeCode, r.employeeName);
  for (const r of rosterReps) repsByCode.set(r.employeeCode, r.employeeName);
  for (const r of masterReps) repsByCode.set(r.employeeCode, r.pineName); // canonical Pine name wins
  return Array.from(repsByCode.entries())
    .map(([employeeCode, employeeName]) => ({ employeeCode, employeeName }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
