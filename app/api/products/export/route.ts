import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER = ["Item No.", "Item Description", "Series", "Size", "Pack Size", "Principal", "Cost Price", "Classification", "SSU Conversion"] as const;

function csvEscape(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const products = await prisma.product.findMany({ orderBy: { itemNo: "asc" } });
  const lines = [HEADER.join(","), ...products.map((product) => [
    product.itemNo, product.itemDescription, product.series, product.size, product.packSize, product.principal,
    product.costPrice, product.classification, product.ssuConversion,
  ].map(csvEscape).join(","))];
  const filename = `product-master-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
