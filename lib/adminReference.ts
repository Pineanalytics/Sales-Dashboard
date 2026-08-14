// Shared canonical lookup values for the admin entry forms. Employee Roaster is
// the source of truth when it is present; historical JP/Rep Call/Target data only
// supplements it so an older record never vanishes from an admin lookup.
import { prisma } from "./db";

export interface KnownRep {
  employeeCode: string;
  employeeName: string;
}

export async function getKnownPrincipals(): Promise<string[]> {
  const [referencePrincipals, targetPrincipals, masterPrincipals, contributionPrincipals] = await Promise.all([
    prisma.principal.findMany({ select: { principal: true }, distinct: ["principal"] }),
    prisma.target.findMany({ select: { principal: true }, distinct: ["principal"] }),
    prisma.employeeMaster.findMany({ where: { active: true }, select: { absolutePrincipal: true }, distinct: ["absolutePrincipal"] }),
    prisma.employeePrincipalContribution.findMany({ select: { principal: true }, distinct: ["principal"] }),
  ]);
  return Array.from(
    new Set([
      ...referencePrincipals.map((p) => p.principal),
      ...masterPrincipals.map((p) => p.absolutePrincipal),
      ...contributionPrincipals.map((p) => p.principal),
      ...targetPrincipals.map((p) => p.principal),
    ])
  ).sort();
}

/**
 * Selectable SAP salesperson names. The rep-actual tables are populated by the
 * direct SAP bridge, so this list follows the names SAP is currently sending
 * rather than relying on manually typed roster values. Existing roster and
 * assignment values remain as a fallback for a historical rep whose SAP rows
 * have aged out of the retained actuals window.
 */
export async function getKnownSapSalesReps(): Promise<string[]> {
  const [dailyReps, monthlyReps, dailyCustomerReps, customerReps, masterReps, assignedReps] = await Promise.all([
    prisma.dailySalesRepActual.findMany({ select: { sapName: true }, distinct: ["sapName"] }),
    prisma.salesRepActual.findMany({ select: { sapName: true }, distinct: ["sapName"] }),
    prisma.dailyBrandCustomerActual.findMany({ select: { sapName: true }, distinct: ["sapName"] }),
    prisma.brandCustomerActual.findMany({ select: { sapName: true }, distinct: ["sapName"] }),
    prisma.employeeMaster.findMany({ select: { sapName: true }, distinct: ["sapName"] }),
    prisma.teamLeaderAssignment.findMany({ select: { sapName: true }, distinct: ["sapName"] }),
  ]);

  return Array.from(
    new Set([
      ...dailyReps.map((row) => row.sapName),
      ...monthlyReps.map((row) => row.sapName),
      ...dailyCustomerReps.map((row) => row.sapName),
      ...customerReps.map((row) => row.sapName),
      ...masterReps.map((row) => row.sapName),
      ...assignedReps.map((row) => row.sapName),
    ].filter((name): name is string => typeof name === "string" && Boolean(name.trim())).map((name) => name.trim()))
  ).sort((a, b) => a.localeCompare(b));
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
