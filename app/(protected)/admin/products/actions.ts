"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";
import { normalizePrincipalKey } from "@/lib/normalize";
import { importProductMaster } from "@/lib/productMasterImport";
import { parseProductsWorkbook, ProductsParseError } from "@/lib/parseProducts";

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
        itemDescription: str(formData, "itemDescription") || null,
        series: str(formData, "series") || null,
        size: str(formData, "size") || null,
        packSize: num(formData, "packSize"),
        principal: str(formData, "principal"),
        costPrice: num(formData, "costPrice"),
        classification: str(formData, "classification") || null,
        ssuConversion: num(formData, "ssuConversion"),
      },
    });
    await prisma.unmappedProductSale.deleteMany({ where: { itemNo } });
  } catch (err: unknown) {
    const message =
      typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002"
        ? "A product with that Item No. already exists."
        : "Failed to create the product.";
    redirect("/admin/products?error=" + encodeURIComponent(message));
  }

  invalidateDatasetCache();
  const message = encodeURIComponent(`Added ${itemNo}. The next current-month sync will map new activity; run the controlled Sales backfill for earlier months.`);
  // "Map & next" from the review panel: keep going straight to the next worklist item.
  const nextItemNo = str(formData, "nextItemNo");
  if (nextItemNo && str(formData, "afterSave") === "next") {
    redirect(`/admin/products?add=${encodeURIComponent(nextItemNo)}&success=${message}`);
  }
  redirect("/admin/products?success=" + message);
}

export async function updateProductAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "productId");

  try {
    const target = await prisma.product.findUnique({ where: { id }, select: { itemNo: true } });
    if (!target) redirect("/admin/products?error=" + encodeURIComponent("Product not found."));
    await prisma.product.update({
      where: { id },
      data: {
        itemDescription: str(formData, "itemDescription") || null,
        series: str(formData, "series") || null,
        size: str(formData, "size") || null,
        packSize: num(formData, "packSize"),
        principal: str(formData, "principal"),
        costPrice: num(formData, "costPrice"),
        classification: str(formData, "classification") || null,
        ssuConversion: num(formData, "ssuConversion"),
      },
    });
    await prisma.unmappedProductSale.deleteMany({ where: { itemNo: target.itemNo } });
  } catch {
    redirect("/admin/products?error=" + encodeURIComponent("Failed to update the product."));
  }

  invalidateDatasetCache();
  redirect("/admin/products?success=" + encodeURIComponent("Product updated. The next current-month sync will use this mapping; run the controlled Sales backfill for earlier months."));
}

export async function uploadProductsAction(formData: FormData) {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/admin/products?error=" + encodeURIComponent("Attach a Product Master CSV or workbook to upload."));
  }

  let result: Awaited<ReturnType<typeof importProductMaster>>;
  try {
    const rows = parseProductsWorkbook(await file.arrayBuffer());
    result = await importProductMaster(rows);
    await prisma.unmappedProductSale.deleteMany({ where: { itemNo: { in: rows.map((row) => row.itemNo) } } });
  } catch (error) {
    const message = error instanceof ProductsParseError ? error.message : "Failed to import the Product Master file.";
    redirect("/admin/products?error=" + encodeURIComponent(message));
  }
  invalidateDatasetCache();
  redirect(
    "/admin/products?success=" +
      encodeURIComponent(
        `Imported ${result.total} products: ${result.inserted} new, ${result.updated} updated, across ${result.principals.length} product principals. Run the controlled Sales backfill to update earlier-month sales.`
      )
  );
}

/** Applies one item-prefix rule suggestion to the Product Master. Refuses when
 *  the suggested principal has no Active Principal row: the sales pipeline
 *  drops any line whose "<principal>-<location>" row is missing, so mapping the
 *  product first would make its sales silently disappear. */
export async function applyPrefixSuggestionAction(formData: FormData) {
  await requireAdmin();
  const itemNo = str(formData, "itemNo");
  const principal = str(formData, "principal");
  if (!itemNo || !principal) {
    redirect("/admin/products?error=" + encodeURIComponent("Item No. and principal are required."));
  }

  const activePrincipals = await prisma.principal.findMany({ where: { status: "Active" }, select: { principal: true } });
  const hasActiveRow = activePrincipals.some((row) => normalizePrincipalKey(row.principal) === normalizePrincipalKey(principal));
  if (!hasActiveRow) {
    redirect(
      "/admin/products?error=" +
        encodeURIComponent(`No Active principal named ${principal} exists. Create it under Admin → Principals first, otherwise ${itemNo}'s sales would drop out of the dashboard.`)
    );
  }

  const target = await prisma.product.findUnique({ where: { itemNo }, select: { id: true } });
  if (!target) redirect("/admin/products?error=" + encodeURIComponent("Product not found."));

  await prisma.product.update({ where: { id: target.id }, data: { principal } });
  await prisma.unmappedProductSale.deleteMany({ where: { itemNo } });
  invalidateDatasetCache();
  redirect(
    "/admin/products?success=" +
      encodeURIComponent(`${itemNo} now maps to ${principal}. The next current-month sync uses it; run the controlled Sales backfill to restate earlier months.`)
  );
}

export async function deleteProductAction(formData: FormData) {
  await requireAdmin();
  const id = str(formData, "productId");

  const target = await prisma.product.findUnique({ where: { id } });
  if (!target) {
    redirect("/admin/products?error=" + encodeURIComponent("Product not found."));
  }

  await prisma.product.delete({ where: { id } });
  invalidateDatasetCache();
  redirect("/admin/products?success=" + encodeURIComponent(`Removed ${target.itemNo}.`));
}
