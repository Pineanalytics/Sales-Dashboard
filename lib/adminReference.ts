// Shared "known values" lookups for the admin entry forms (Team Leaders, Targets) —
// best-effort lists inferred from data already uploaded (JP Adherence, Rep Call,
// existing Target rows), not a canonical master roster. If a clean Principal/Rep/Team
// Leader/Location reference table gets uploaded later, only these functions need to
// change to source dropdown options from it instead — every page calling them stays
// as-is.
import { prisma } from "./db";

export interface KnownRep {
  employeeCode: string;
  employeeName: string;
}

export async function getKnownPrincipals(): Promise<string[]> {
  const [jpPrincipals, targetPrincipals] = await Promise.all([
    prisma.jPMonthlySplitRow.findMany({ select: { costCentre: true }, distinct: ["costCentre"] }),
    prisma.target.findMany({ select: { principal: true }, distinct: ["principal"] }),
  ]);
  return Array.from(new Set([...jpPrincipals.map((p) => p.costCentre), ...targetPrincipals.map((p) => p.principal)])).sort();
}

export async function getKnownMainPrincipals(): Promise<string[]> {
  const rows = await prisma.target.findMany({ select: { mainPrincipal: true }, distinct: ["mainPrincipal"] });
  return Array.from(new Set(rows.map((r) => r.mainPrincipal).filter((v): v is string => !!v))).sort();
}

export async function getKnownReps(): Promise<KnownRep[]> {
  const [jpReps, repCallReps] = await Promise.all([
    prisma.jPAdherenceDetail.findMany({ select: { employeeCode: true, employeeName: true }, distinct: ["employeeCode"], take: 2000 }),
    prisma.repCall.findMany({ select: { employeeCode: true, salesRep: true }, distinct: ["employeeCode"], take: 2000 }),
  ]);
  const repsByCode = new Map<string, string>();
  for (const r of repCallReps) repsByCode.set(r.employeeCode, r.salesRep);
  for (const r of jpReps) repsByCode.set(r.employeeCode, r.employeeName); // JP Adherence names win — same source RepContribution uses
  return Array.from(repsByCode.entries())
    .map(([employeeCode, employeeName]) => ({ employeeCode, employeeName }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}
