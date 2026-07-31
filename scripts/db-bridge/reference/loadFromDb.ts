// Loads Products/Warehouses/Key Account Reps from Postgres (admin-editable via
// app/(protected)/admin/{products,warehouses,key-account-reps}) instead of the
// earlier network-share Excel read / static JSON snapshots. Principals stays a
// static checked-in snapshot (scripts/db-bridge/reference/principals.json) — not
// migrated, since it wasn't requested for inline editing.
import { prisma } from "@/lib/db";
import type { WarehouseRow } from "../transform/buildMonthlySales";

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
