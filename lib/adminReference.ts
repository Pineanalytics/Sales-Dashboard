// Shared canonical lookup values for the admin entry forms. Employee Roaster is
// the source of truth when it is present; historical JP/Rep Call/Target data only
// supplements it so an older record never vanishes from an admin lookup.
import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "./db";

export interface KnownRep {
  employeeCode: string;
  employeeName: string;
}

// Prisma's findMany({ distinct }) does not de-duplicate in the database: it fetches every row and drops repeats in memory. On the sales
// tables below (millions of rows) that made the Employee Roster hang on every load and save, so these lists use SQL DISTINCT / UNION.

export async function getKnownPrincipals(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ principal: string }[]>(Prisma.sql`
    (SELECT DISTINCT principal FROM "Principal")
    UNION (SELECT DISTINCT principal FROM "Target")
    UNION (SELECT DISTINCT "absolutePrincipal" FROM "EmployeeMaster" WHERE active)
    UNION (SELECT DISTINCT principal FROM "EmployeePrincipalContribution")
  `);
  return rows.map((row) => row.principal).filter((principal): principal is string => typeof principal === "string").sort();
}

async function loadKnownSapSalesReps(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>(Prisma.sql`
    SELECT BTRIM(name) AS name FROM (
      -- Each source de-duplicated on its own first (a hash aggregate per table); one UNION over the raw rows sorted them all on disk.
      (SELECT DISTINCT "displayName" AS name FROM "RepDirectoryEntry" WHERE source = 'SAP')
      UNION ALL (SELECT DISTINCT "sapName" FROM "DailySalesRepActual")
      UNION ALL (SELECT DISTINCT "sapName" FROM "SalesRepActual")
      UNION ALL (SELECT DISTINCT "sapName" FROM "DailyBrandCustomerActual")
      UNION ALL (SELECT DISTINCT "sapName" FROM "BrandCustomerActual")
      UNION ALL (SELECT DISTINCT "sapName" FROM "EmployeeMaster")
      UNION ALL (SELECT DISTINCT "sapName" FROM "TeamLeaderAssignment")
    ) names
    WHERE name IS NOT NULL AND BTRIM(name) <> ''
    GROUP BY BTRIM(name)
  `);
  return rows.map((row) => row.name).sort((a, b) => a.localeCompare(b));
}

const loadKnownSapSalesRepsCached = unstable_cache(loadKnownSapSalesReps, ["known-sap-sales-reps"], { revalidate: 300 });

/**
 * Selectable SAP salesperson names: every salesperson in the rep directory (SAP's own
 * salesperson list, so a rep with no sales yet can be picked), plus the names the direct SAP
 * bridge has sent on sales rows. Existing roster and assignment values remain as a fallback
 * for a historical rep whose SAP rows have aged out of the retained actuals window.
 * Reused for five minutes for the page's picker: it reads the large sales tables, and the list changes slowly. The save action checks
 * against getKnownSapSalesRepsFresh, so a name that appeared in the last few minutes is still accepted.
 */
export async function getKnownSapSalesReps(): Promise<string[]> {
  return loadKnownSapSalesRepsCached();
}

/** The same list, read now (one query), for validating a save. */
export async function getKnownSapSalesRepsFresh(): Promise<string[]> {
  return loadKnownSapSalesReps();
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
