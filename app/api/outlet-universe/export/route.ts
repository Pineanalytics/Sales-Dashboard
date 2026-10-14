import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { OUTLET_SOURCE_LABELS, boughtWithin, buyingTenure, dormancyFlag, longPurchaseConsistency, principalMix, purchaseConsistency, type OutletSource } from "@/lib/outletUniverse/normalize";
import { exportOutlets, parseOutletFilters } from "@/lib/outletUniverse/query";
import { buildNameProfiles, classification2, cleanPlaces, tierRow } from "@/lib/outletUniverse/tiering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The extract follows the tiering workbook ("active-outlets-principal-2026-Analysis", columns A to AH); the columns after it are extra.
// Channel is Wholesale or Retail only (Wholesale = outlet type Wholesalers); no General place and no Unspecified segment; outlets that
// share a name share one channel, segment and tier, from their combined average sale (see lib/outletUniverse/tiering.ts).
const HEADER = [
  "Source", "Outlet ID", "Outlet", "Principal(s)", "Classification", "Classification2", "Channel", "Segment / Type", "Location", "Region", "Territory", "Route", "Rep", "Latitude", "Longitude",
  "Last Purchase", "Status", "Days Since Purchase", "Dormancy Flag", "Sales YTD", "Average Sales", "Transactions YTD",
  // Buying history: tenure from the first purchase on record, consistency over the last three 30-day periods.
  "Buying Since", "Months Buying", "Buying Tenure", "Periods Bought (last 3 x 30 days)", "Consistency",
  // Portfolio: the principal that dominates the outlet's sales and the others it shares with.
  "Dominant Principal", "Dominant Share %", "Principal Mix", "Principals Bought", "Shared Principals",
  "Tier", "Combined Avg Sales (Outlet)",
  // Extra columns after the workbook's: purchase windows, six-month consistency, and the source system's own channel and type.
  "Bought Last 30 Days", "Bought Last 3 Months", "Bought Last 6 Months", "Periods Bought (last 6 x 30 days)", "Consistency (6 months)", "Source Channel", "Source Segment / Type",
  // Rep (above) is the rep who sells the row's principal. Reps: how many different reps sell the outlet across its principals and who sells which;
  // Journey Plan Rep is the outlet's planned owner in Pine, the same on every principal.
  "Reps Serving", "Multi-Rep Outlet", "Reps by Principal", "Journey Plan Rep",
  // The same shop in another system (no shared id): matched by name, place and GPS point. Flagged, not merged.
  "In Other System", "Match ID", "Matched Systems", "Match Confidence",
  // Who the rep is in the roster: their SFA user code or ID as their own system supplies it (Pine and EABL: the roster code, Leverage: the Centegy
  // sales rep code, Upfield: the DataEdge login) and their Team Leader (per principal; blank where the rep is not on the roster), then whether
  // the rep is an Active or Inactive worker and the region and sub-region they are placed in.
  "Rep SFA ID", "Team Leader", "Team Leaders by Principal", "Rep Status", "Rep Region", "Rep Sub-Region",
];

/** CSV cells that start with = + - @ are neutralised so a spreadsheet never runs an outlet name as a formula. */
function cell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let textValue = String(value);
  if (/^[=+\-@\t\r]/.test(textValue) && typeof value === "string") textValue = `'${textValue}`;
  return /[",\r\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

const round2 = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

/** Every outlet matching the dashboard's filters, as a CSV. */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const filters = parseOutletFilters(req.nextUrl.searchParams);
    const rows = await exportOutlets(filters, access.scope);
    // Name-level channel, segment and tier come from every row of the same view in the viewer's scope, whatever the dashboard filters
    // are, so an outlet keeps the same tier when the export is narrowed to one principal.
    const universe = await exportOutlets({ ...parseOutletFilters(new URLSearchParams({ view: filters.view })), status: "all" }, access.scope, { withMix: false });
    const profiles = buildNameProfiles(universe);
    const lines = [HEADER.map(cell).join(",")];
    const now = new Date();
    for (const row of rows) {
      const tenure = buyingTenure(row.firstPurchaseDate, now);
      const daysSince = row.lastPurchaseDate ? Math.max(0, Math.floor((now.getTime() - new Date(row.lastPurchaseDate).getTime()) / 86_400_000)) : null;
      const tiered = tierRow(row, profiles);
      const places = cleanPlaces(row);
      lines.push(
        [
          OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source,
          row.outletKey,
          row.outletName,
          row.principals,
          row.salesRole,
          classification2(row.salesRole),
          tiered.channel,
          tiered.segment,
          places.location,
          places.region,
          places.territory,
          row.route,
          row.repName,
          row.latitude,
          row.longitude,
          row.lastPurchaseDate,
          row.active ? "Active" : "Dormant",
          daysSince,
          row.active ? null : (dormancyFlag(row.lastPurchaseDate)?.flag ?? null),
          round2(row.sales),
          round2(tiered.averageSales),
          row.transactions,
          row.firstPurchaseDate,
          tenure.months,
          tenure.band,
          row.periodsBought90,
          purchaseConsistency(row.periodsBought90),
          row.dominantPrincipal ?? row.principals,
          row.dominantShare === null ? null : Math.round(row.dominantShare * 1000) / 10,
          principalMix(row.principalCount, row.dominantShare),
          row.principalCount,
          row.sharedPrincipals,
          tiered.tier,
          round2(tiered.combinedAverage),
          boughtWithin(row.lastPurchaseDate, 30, now) ? "Yes" : "No",
          boughtWithin(row.lastPurchaseDate, 91, now) ? "Yes" : "No",
          boughtWithin(row.lastPurchaseDate, 183, now) ? "Yes" : "No",
          row.periodsBought180,
          longPurchaseConsistency(row.periodsBought180),
          row.channel,
          row.segment,
          row.repCount,
          row.repCount > 1 ? "Yes" : "No",
          row.repsByPrincipal,
          row.plannedRep,
          row.matchId ? "Yes" : "No",
          row.matchId,
          row.matchedSystems,
          row.matchConfidence,
          row.repCode,
          row.teamLeader,
          row.teamLeadersByPrincipal,
          row.repStatus,
          row.repRegion,
          row.repSubRegion,
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
