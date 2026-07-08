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

export async function createKeyAccountRepAction(formData: FormData) {
  await requireAdmin();

  const rep = str(formData, "rep");
  if (!rep) {
    redirect("/admin/key-account-reps?error=" + encodeURIComponent("Rep name is required."));
  }

  try {
    await prisma.keyAccountRep.create({
      data: {
        rep,
        channel: str(formData, "channel"),
        teamLeader: str(formData, "teamLeader"),
      },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A key account rep with that name already exists."
        : "Failed to create the key account rep.";
    redirect("/admin/key-account-reps?error=" + encodeURIComponent(message));
  }

  redirect("/admin/key-account-reps?success=" + encodeURIComponent(`Added ${rep}.`));
}

export async function updateKeyAccountRepAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "repId");

  try {
    await prisma.keyAccountRep.update({
      where: { id },
      data: {
        channel: str(formData, "channel"),
        teamLeader: str(formData, "teamLeader"),
      },
    });
  } catch {
    redirect("/admin/key-account-reps?error=" + encodeURIComponent("Failed to update the key account rep."));
  }

  redirect("/admin/key-account-reps?success=" + encodeURIComponent("Key account rep updated."));
}

export async function deleteKeyAccountRepAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "repId");

  const target = await prisma.keyAccountRep.findUnique({ where: { id } });
  if (!target) {
    redirect("/admin/key-account-reps?error=" + encodeURIComponent("Key account rep not found."));
  }

  await prisma.keyAccountRep.delete({ where: { id } });
  redirect("/admin/key-account-reps?success=" + encodeURIComponent(`Removed ${target.rep}.`));
}
