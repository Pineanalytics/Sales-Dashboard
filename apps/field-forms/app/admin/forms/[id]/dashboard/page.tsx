import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import DashboardSubNav from "./DashboardSubNav";
import { byLabel, getFormFieldsAndRows } from "@/lib/formData";
import {
  buildGroupSummaries,
  buildPhotoFeed,
  countByField,
  countsInOptionOrder,
  effectiveLabel,
  rateOfValue,
  uniqueValueCount,
  visitsByDate,
  averageNumeric,
  type GroupSummary,
} from "@/lib/dashboard";
import type {
  DashboardData,
  OosLogRow,
  SummaryRow,
  VisitRow,
} from "./dashboardTypes";
import DashboardTabs from "./DashboardTabs";

function toSummaryRow(g: GroupSummary, linkHref?: string): SummaryRow {
  return {
    name: g.key,
    visits: g.visits,
    avgSos: g.avgSharePct,
    avgShelfOcc: g.avgShelfOccupiedPct,
    oos: g.oosYes,
    oosRatePct: g.oosTotal ? Math.round((g.oosYes / g.oosTotal) * 100) : 0,
    avgPos: g.avgPositioning,
    deliveryRatePct: g.deliveryTotal
      ? Math.round((g.delivered / g.deliveryTotal) * 100)
      : 0,
    linkHref,
  };
}

export default async function FormDashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { from, to } = await searchParams;
  const supabase = await createClient();

  const { form, fields, rows } = await getFormFieldsAndRows(supabase, id, { from, to });
  if (!form) notFound();

  const exportQsParams = new URLSearchParams();
  if (from) exportQsParams.set("from", from);
  if (to) exportQsParams.set("to", to);
  const exportQs = exportQsParams.toString() ? `?${exportQsParams.toString()}` : "";

  const merchandiser = byLabel(fields, "Merchandiser Name");
  const retailer = byLabel(fields, "Retailer Name");
  const retailerOther = byLabel(fields, "Retailer Name (if Other)");
  const region = byLabel(fields, "Region");
  const location = byLabel(fields, "Retailer Location / Branch");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const oosItems = byLabel(fields, "OOS List Of Items");
  const competitor = byLabel(fields, "Competitor Activity Present");
  const skus = byLabel(fields, "SKUs Listed / Placed in Store");
  const shelfSpace = byLabel(fields, "Shelf Space % Occupied");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");
  const poStatus = byLabel(fields, "Purchase Order Status");
  const delivery = byLabel(fields, "Delivery Status");
  const photo = byLabel(fields, "Shelf Photo");

  const total = rows.length;

  const avgSos = shelfPct ? averageNumeric(rows, shelfPct.id) : null;
  const avgPos = positioning ? averageNumeric(rows, positioning.id) : null;
  const oosRate = oos ? rateOfValue(rows, oos.id, "Yes") : { rate: 0 };
  const deliveryRate = delivery
    ? rateOfValue(rows, delivery.id, "Order Delivered")
    : { rate: 0 };
  const competitorRate = competitor
    ? rateOfValue(rows, competitor.id, "Yes")
    : { rate: 0 };

  const dates = rows.map((r) => r.submittedAt.slice(0, 10)).sort();
  const dateRangeLabel =
    dates.length > 0
      ? dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} – ${dates[dates.length - 1]}`
      : "—";

  const groupFieldIds = {
    sharePct: shelfPct?.id,
    oos: oos?.id,
    positioning: positioning?.id,
    delivery: delivery?.id,
    shelfSpace: shelfSpace?.id,
    outlet: location?.id,
    outletOther: locationOther?.id,
  };

  const merchSummaries = merchandiser
    ? buildGroupSummaries(rows, {
        group: merchandiser.id,
        ...groupFieldIds,
      }).sort((a, b) => b.visits - a.visits)
    : [];

  const retailerSummaries = retailer
    ? buildGroupSummaries(rows, {
        group: retailer.id,
        groupOther: retailerOther?.id,
        ...groupFieldIds,
      }).sort((a, b) => b.visits - a.visits)
    : [];

  const regionSummaries = region
    ? buildGroupSummaries(rows, {
        group: region.id,
        ...groupFieldIds,
      }).sort((a, b) => b.visits - a.visits)
    : [];

  const oosLog: OosLogRow[] = oos
    ? rows
        .filter((r) => r.answers[oos.id] === "Yes")
        .map((r) => ({
          id: r.id,
          date: r.submittedAt.slice(0, 10),
          merchandiser: merchandiser ? r.answers[merchandiser.id] ?? "" : "",
          retailer: retailer
            ? effectiveLabel(
                r.answers[retailer.id],
                retailerOther ? r.answers[retailerOther.id] : undefined
              )
            : "",
          branch: location
            ? effectiveLabel(
                r.answers[location.id],
                locationOther ? r.answers[locationOther.id] : undefined
              )
            : "",
          region: region ? r.answers[region.id] ?? "" : "",
          itemsReported:
            (oosItems ? r.answers[oosItems.id] : "") || "Not itemized",
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  const rawRows: VisitRow[] = rows
    .map((r) => {
      const d = new Date(r.submittedAt);
      return {
        id: r.id,
        date: r.submittedAt.slice(0, 10),
        time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        merchandiser: merchandiser ? r.answers[merchandiser.id] ?? "" : "",
        retailer: retailer
          ? effectiveLabel(
              r.answers[retailer.id],
              retailerOther ? r.answers[retailerOther.id] : undefined
            )
          : "",
        region: region ? r.answers[region.id] ?? "" : "",
        branch: location
          ? effectiveLabel(
              r.answers[location.id],
              locationOther ? r.answers[locationOther.id] : undefined
            )
          : "",
        sosPct: shelfPct ? parseFloatOrNull(r.answers[shelfPct.id]) : null,
        oos: oos ? r.answers[oos.id] ?? "" : "",
        competitor: competitor ? r.answers[competitor.id] ?? "" : "",
        skuCount: skus
          ? (r.answers[skus.id] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
              .length
          : 0,
        shelfOccPct: shelfSpace ? parseFloatOrNull(r.answers[shelfSpace.id]) : null,
        positioning: positioning ? r.answers[positioning.id] ?? "" : "",
        poStatus: poStatus ? r.answers[poStatus.id] ?? "" : "",
        delivery: delivery ? r.answers[delivery.id] ?? "" : "",
      };
    })
    .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));

  const photos =
    photo && location
      ? buildPhotoFeed(rows, photo.id, {
          location: location.id,
          locationOther: locationOther?.id,
          retailer: retailer?.id,
          retailerOther: retailerOther?.id,
        })
      : [];

  const data: DashboardData = {
    formId: id,
    kpis: {
      totalVisits: total,
      avgSos,
      oosRatePct: Math.round(oosRate.rate * 1000) / 10,
      avgPos,
      deliveryRatePct: Math.round(deliveryRate.rate * 1000) / 10,
      competitorRatePct: Math.round(competitorRate.rate * 1000) / 10,
      retailers: retailer ? uniqueValueCount(rows, retailer.id) : 0,
      branches: location ? uniqueValueCount(rows, location.id) : 0,
      regions: region ? uniqueValueCount(rows, region.id) : 0,
      dateRangeLabel,
    },
    dailyVisits: visitsByDate(rows),
    posDist: positioning
      ? countsInOptionOrder(rows, positioning.id, positioning.options ?? [])
          .map((c) => ({ label: `Score ${c.label}`, count: c.count }))
      : [],
    poDist: poStatus ? countByField(rows, poStatus.id) : [],
    deliveryDist: delivery ? countByField(rows, delivery.id) : [],
    merch: merchSummaries.map((g) =>
      toSummaryRow(g, `/admin/forms/${id}/dashboard/merchandisers/${encodeURIComponent(g.key)}`)
    ),
    retailer: retailerSummaries.map((g) =>
      toSummaryRow(g, `/admin/forms/${id}/dashboard/retailers/${encodeURIComponent(g.key)}`)
    ),
    region: regionSummaries.map((g) => toSummaryRow(g)),
    oosLog,
    rawRows,
    photos,
  };

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between gap-4 mb-2">
          <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)]">
            Dashboard
          </p>
          {total > 0 && (
            <div className="flex gap-2">
              <a
                href={`/admin/forms/${id}/dashboard/export${exportQs}`}
                className="shrink-0 rounded-md border border-[var(--line)] bg-white text-sm font-medium text-[var(--ink-600)] px-3.5 py-1.5 hover:border-[var(--pine-500)] hover:text-[var(--pine-700)] transition-colors"
              >
                ⬇ Export HTML
              </a>
              <a
                href={`/admin/forms/${id}/dashboard/export-excel${exportQs}`}
                className="shrink-0 rounded-md border border-[var(--line)] bg-white text-sm font-medium text-[var(--ink-600)] px-3.5 py-1.5 hover:border-[var(--pine-500)] hover:text-[var(--pine-700)] transition-colors"
              >
                ⬇ Export Excel
              </a>
            </div>
          )}
        </div>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">
          {form.title}
        </h1>

        <FormAdminNav formId={id} />
        <DashboardSubNav formId={id} />

        {total === 0 ? (
          <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
            No submissions yet — the dashboard will fill in once responses
            come in.
          </div>
        ) : (
          <DashboardTabs data={data} />
        )}
      </div>
    </main>
  );
}

function parseFloatOrNull(v: string | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}
