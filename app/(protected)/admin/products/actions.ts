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

function num(formData: FormData, name: string): number | null {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function str(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function createProductAction(formData: FormData) {
  await requireAdmin();

  const itemNo = str(formData, "itemNo");
  if (!itemNo) {
    redirect("/admin/products?error=" + encodeURIComponent("Item No. is required."));
  }

  try {
    await prisma.product.create({
      data: {
        itemNo,
        packSize: num(formData, "packSize"),
        principal: str(formData, "principal"),
        costPrice: num(formData, "costPrice"),
        classification: str(formData, "classification") || null,
        ssuConversion: num(formData, "ssuConversion"),
      },
    });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A product with that Item No. already exists."
        : "Failed to create the product.";
    redirect("/admin/products?error=" + encodeURIComponent(message));
  }

  redirect("/admin/products?success=" + encodeURIComponent(`Added ${itemNo}.`));
}

export async function updateProductAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "productId");

  try {
    await prisma.product.update({
      where: { id },
      data: {
        packSize: num(formData, "packSize"),
        principal: str(formData, "principal"),
        costPrice: num(formData, "costPrice"),
        classification: str(formData, "classification") || null,
        ssuConversion: num(formData, "ssuConversion"),
      },
    });
  } catch {
    redirect("/admin/products?error=" + encodeURIComponent("Failed to update the product."));
  }

  redirect("/admin/products?success=" + encodeURIComponent("Product updated."));
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "productId");

  const target = await prisma.product.findUnique({ where: { id } });
  if (!target) {
    redirect("/admin/products?error=" + encodeURIComponent("Product not found."));
  }

  await prisma.product.delete({ where: { id } });
  redirect("/admin/products?success=" + encodeURIComponent(`Removed ${target.itemNo}.`));
}
