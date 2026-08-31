"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";

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

function nullableStr(formData: FormData, name: string): string | null {
  const v = str(formData, name);
  return v || null;
}

export async function createPrincipalAction(formData: FormData) {
  await requireAdmin();

  const principal = str(formData, "principal");
  if (!principal) {
    redirect("/admin/principals?error=" + encodeURIComponent("Principal is required."));
  }

  try {
    await prisma.principal.create({
      data: {
        principal,
        mainPrincipal: str(formData, "mainPrincipal"),
        location: str(formData, "location"),
        locationCode: nullableStr(formData, "locationCode"),
        status: str(formData, "status") || "Active",
        teamLeaderId: nullableStr(formData, "teamLeaderId"),
      },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A principal with that name already exists."
        : "Failed to create the principal.";
    redirect("/admin/principals?error=" + encodeURIComponent(message));
  }

  invalidateDatasetCache();
  redirect("/admin/principals?success=" + encodeURIComponent(`Added ${principal}.`));
}

export async function updatePrincipalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "principalId");

  try {
    await prisma.principal.update({
      where: { id },
      data: {
        mainPrincipal: str(formData, "mainPrincipal"),
        location: str(formData, "location"),
        locationCode: nullableStr(formData, "locationCode"),
        status: str(formData, "status") || "Active",
        teamLeaderId: nullableStr(formData, "teamLeaderId"),
      },
    });
  } catch {
    redirect("/admin/principals?error=" + encodeURIComponent("Failed to update the principal."));
  }

  invalidateDatasetCache();
  redirect("/admin/principals?success=" + encodeURIComponent("Principal updated."));
}

export async function deletePrincipalAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "principalId");

  const target = await prisma.principal.findUnique({ where: { id } });
  if (!target) {
    redirect("/admin/principals?error=" + encodeURIComponent("Principal not found."));
  }

  await prisma.principal.delete({ where: { id } });
  invalidateDatasetCache();
  redirect("/admin/principals?success=" + encodeURIComponent(`Removed ${target.principal}.`));
}
