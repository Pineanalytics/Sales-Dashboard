"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session.user;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function createWarehouseAction(formData: FormData) {
  await requireAdmin();

  const warehouseCode = str(formData, "warehouseCode");
  if (!warehouseCode) {
    redirect("/admin/warehouses?error=" + encodeURIComponent("Warehouse code is required."));
  }

  try {
    await prisma.warehouse.create({
      data: {
        warehouseCode,
        warehouseName: str(formData, "warehouseName"),
        location: str(formData, "location"),
        locationCode: str(formData, "locationCode"),
      },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A warehouse with that code already exists."
        : "Failed to create the warehouse.";
    redirect("/admin/warehouses?error=" + encodeURIComponent(message));
  }

  redirect("/admin/warehouses?success=" + encodeURIComponent(`Added ${warehouseCode}.`));
}

export async function updateWarehouseAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "warehouseId");

  try {
    await prisma.warehouse.update({
      where: { id },
      data: {
        warehouseName: str(formData, "warehouseName"),
        location: str(formData, "location"),
        locationCode: str(formData, "locationCode"),
      },
    });
  } catch {
    redirect("/admin/warehouses?error=" + encodeURIComponent("Failed to update the warehouse."));
  }

  redirect("/admin/warehouses?success=" + encodeURIComponent("Warehouse updated."));
}

export async function deleteWarehouseAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "warehouseId");

  const target = await prisma.warehouse.findUnique({ where: { id } });
  if (!target) {
    redirect("/admin/warehouses?error=" + encodeURIComponent("Warehouse not found."));
  }

  await prisma.warehouse.delete({ where: { id } });
  redirect("/admin/warehouses?success=" + encodeURIComponent(`Removed ${target.warehouseCode}.`));
}
