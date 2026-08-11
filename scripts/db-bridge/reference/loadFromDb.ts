// Loads Products/Warehouses/Key Account Reps/Principals from Postgres
// (admin-editable via app/(protected)/admin/{products,warehouses,
// key-account-reps,principals}) instead of the earlier network-share Excel
// read / static JSON snapshots. Principals was the last holdout (a static
// scripts/db-bridge/reference/principals.json snapshot) until TL Ranking
// started needing its teamLeader field live (lib/tlRanking.ts) rather than
// just for internal SQL-bridge principal resolution — see loadPrincipals.
import { prisma } from "@/lib/db";
import type { PrincipalRow, WarehouseRow } from "../transform/buildMonthlySales";

export interface ProductRow {
  itemNo: string;
  packSize: number | null;
  principal: string;
  costPrice: number | null;
  classification: string;
  ssuConversion: number | null;
}

export interface KeyAccountRepRow {
  rep: string;
  channel: string;
  teamLeader: string;
}

export interface EmployeeMasterReferenceRow {
  employeeCode: string;
  pineName: string;
  sapName: string;
  active: boolean;
}

export async function loadProducts(): Promise<ProductRow[]> {
  const rows = await prisma.product.findMany();
  return rows.map((r) => ({
    itemNo: r.itemNo,
    packSize: r.packSize,
    principal: r.principal,
    costPrice: r.costPrice,
    classification: r.classification ?? "",
    ssuConversion: r.ssuConversion,
  }));
}

export async function loadWarehouses(): Promise<WarehouseRow[]> {
  const rows = await prisma.warehouse.findMany();
  return rows.map((r) => ({
    warehouseCode: r.warehouseCode,
    warehouseName: r.warehouseName,
    location: r.location,
    locationCode: r.locationCode,
  }));
}

/** Replaces the old static principals.json import. teamLeaderId is the id-by-
 *  convention FK (same non-@relation pattern as TeamLeaderAssignment's own
 *  teamLeaderId/supervisorId/managerId) — teamLeader here is just the resolved
 *  display name for consumers that only ever wanted a label; it's carried
 *  through unused by any current scripts/db-bridge transform (confirmed) but
 *  kept for shape compatibility with the old principals.json rows. */
export async function loadPrincipals(): Promise<PrincipalRow[]> {
  const [rows, teamLeaders] = await Promise.all([
    prisma.principal.findMany(),
    prisma.teamLeader.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(teamLeaders.map((t) => [t.id, t.name]));
  return rows.map((r) => ({
    key: r.id,
    principal: r.principal,
    mainPrincipal: r.mainPrincipal,
    location: r.location,
    locationCode: r.locationCode ?? "",
    status: r.status,
    teamLeader: r.teamLeaderId ? nameById.get(r.teamLeaderId) ?? "" : "",
  }));
}

export async function loadKeyAccountReps(): Promise<KeyAccountRepRow[]> {
  const rows = await prisma.keyAccountRep.findMany();
  return rows.map((r) => ({ rep: r.rep, channel: r.channel, teamLeader: r.teamLeader }));
}

/** Employee Roaster rows are read from the app database so the direct SAP sync
 * can resolve SAP salesperson names to Pine employee codes before upload. */
export async function loadEmployeeMaster(): Promise<EmployeeMasterReferenceRow[]> {
  const rows = await prisma.employeeMaster.findMany({
    select: { employeeCode: true, pineName: true, sapName: true, active: true },
  });
  return rows.map((r) => ({ employeeCode: r.employeeCode, pineName: r.pineName, sapName: r.sapName, active: r.active }));
}
