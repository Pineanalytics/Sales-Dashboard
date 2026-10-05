import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import { exportOutlets, parseOutletFilters } from "@/lib/outletUniverse/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADER = ["Source", "Outlet ID", "Outlet", "Principal(s)", "Channel", "Segment / Type", "Location", "Region", "Territory", "Route", "Rep", "Latitude", "Longitude", "Last Purchase", "Status", "Sales YTD", "Transactions YTD"];

/** CSV cells that start with = + - @ are neutralised so a spreadsheet never runs an outlet name as a formula. */
function cell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let textValue = String(value);
  if (/^[=+\-@\t\r]/.test(textValue) && typeof value === "string") textValue = `'${textValue}`;
  return /[",\r\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

/** Every outlet matching the dashboard's filters, as a CSV. */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const filters = parseOutletFilters(req.nextUrl.searchParams);
    const rows = await exportOutlets(filters, access.scope);
    const lines = [HEADER.map(cell).join(",")];
    for (const row of rows) {
      lines.push(
        [
          OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source,
          row.outletKey,
          row.outletName,
          row.principals,
          row.channel,
          row.segment,
          row.location,
          row.region,
          row.territory,
          row.route,
          row.repName,
          row.latitude,
          row.longitude,
          row.lastPurchaseDate,
          row.active ? "Active" : "Inactive",
          Math.round(row.sales * 100) / 100,
          row.transactions,
        ]
          .map(cell)
          .join(",")
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse("﻿" + lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="active-outlets-${filters.view}-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Failed to export Active Outlets", error);
    return NextResponse.json({ error: "Failed to export Active Outlets." }, { status: 500 });
  }
}
