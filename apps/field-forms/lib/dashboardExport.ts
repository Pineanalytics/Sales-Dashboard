import type { FormFieldMeta } from "./formData";
import { byLabel } from "./formData";
import { buildPhotoFeed, effectiveLabel, type SubmissionRow } from "./dashboard";

// Mirrors the DATA contract of the reference static-dashboard mockup exactly
// (same keys, same fraction-not-percent convention) so the exported file's
// embedded script — copied near-verbatim from that mockup — can consume it
// with no translation layer.

interface GroupRecord {
  name: string;
  visits: number;
  avg_sos: number;
  avg_shelf_occ: number;
  oos: number;
  avg_pos: number;
  delivered: number;
  oos_rate: number;
  delivery_rate: number;
}

export interface ExportData {
  kpis: {
    total_visits: number;
    avg_sos: number;
    oos_rate: number;
    avg_pos: number;
    delivery_rate: number;
    competitor_rate: number;
    retailers: number;
    branches: number;
    regions: number;
  };
  merchNameKey: string;
  retailerNameKey: string;
  regionNameKey: string;
  merch: Record<string, string | number>[];
  retailer: Record<string, string | number>[];
  region: Record<string, string | number>[];
  pos_dist: Record<string, number>;
  po_dist: Record<string, number>;
  delivery_dist: Record<string, number>;
  daily: Record<string, number>;
  oos_log: Record<string, string>[];
  raw: Record<string, string | number>[];
  photos: { url: string; outlet: string; retailer: string; date: string }[];
  dateRangeLabel: string;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

function groupBy(rows: SubmissionRow[], keyOf: (r: SubmissionRow) => string) {
  const map = new Map<string, SubmissionRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(r);
  }
  return map;
}

function buildGroupRecords(
  groups: Map<string, SubmissionRow[]>,
  ids: { sharePct?: string; shelfSpace?: string; oos?: string; positioning?: string; delivery?: string }
): GroupRecord[] {
  return [...groups.entries()]
    .map(([name, groupRows]) => {
      const sosVals = ids.sharePct
        ? groupRows.map((r) => parseFloat(r.answers[ids.sharePct!])).filter(isFinite)
        : [];
      const occVals = ids.shelfSpace
        ? groupRows.map((r) => parseFloat(r.answers[ids.shelfSpace!])).filter(isFinite)
        : [];
      const posVals = ids.positioning
        ? groupRows.map((r) => parseFloat(r.answers[ids.positioning!])).filter(isFinite)
        : [];
      const oosAnswered = ids.oos ? groupRows.filter((r) => r.answers[ids.oos!]) : [];
      const oosYes = ids.oos ? oosAnswered.filter((r) => r.answers[ids.oos!] === "Yes").length : 0;
      const deliveryAnswered = ids.delivery
        ? groupRows.filter((r) => r.answers[ids.delivery!])
        : [];
      const delivered = ids.delivery
        ? deliveryAnswered.filter((r) => r.answers[ids.delivery!] === "Order Delivered").length
        : 0;

      return {
        name,
        visits: groupRows.length,
        avg_sos: avg(sosVals),
        avg_shelf_occ: occVals.length ? Math.round(avg(occVals)) / 100 : 0,
        oos: oosYes,
        avg_pos: avg(posVals),
        delivered,
        oos_rate: oosAnswered.length ? Math.round((oosYes / oosAnswered.length) * 100) / 100 : 0,
        delivery_rate: deliveryAnswered.length
          ? Math.round((delivered / deliveryAnswered.length) * 100) / 100
          : 0,
      };
    })
    .sort((a, b) => b.visits - a.visits);
}

function toRecord(g: GroupRecord, nameKey: string): Record<string, string | number> {
  return {
    [nameKey]: g.name,
    visits: g.visits,
    avg_sos: g.avg_sos,
    avg_shelf_occ: g.avg_shelf_occ,
    oos: g.oos,
    avg_pos: g.avg_pos,
    delivered: g.delivered,
    oos_rate: g.oos_rate,
    delivery_rate: g.delivery_rate,
  };
}

export function buildExportData(fields: FormFieldMeta[], rows: SubmissionRow[]): ExportData {
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
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");
  const poStatus = byLabel(fields, "Purchase Order Status");
  const delivery = byLabel(fields, "Delivery Status");
  const photo = byLabel(fields, "Shelf Photo");

  const groupIds = {
    sharePct: shelfPct?.id,
    oos: oos?.id,
    positioning: positioning?.id,
    delivery: delivery?.id,
  };

  const merchGroups = merchandiser
    ? groupBy(rows, (r) => r.answers[merchandiser.id] ?? "")
    : new Map();
  const retailerGroups = retailer
    ? groupBy(rows, (r) =>
        effectiveLabel(r.answers[retailer.id], retailerOther ? r.answers[retailerOther.id] : undefined)
      )
    : new Map();
  const regionGroups = region ? groupBy(rows, (r) => r.answers[region.id] ?? "") : new Map();

  const total = rows.length;
  const sosAll = shelfPct ? rows.map((r) => parseFloat(r.answers[shelfPct.id])).filter(isFinite) : [];
  const posAll = positioning
    ? rows.map((r) => parseFloat(r.answers[positioning.id])).filter(isFinite)
    : [];
  const oosAnsweredAll = oos ? rows.filter((r) => r.answers[oos.id]) : [];
  const oosYesAll = oos ? oosAnsweredAll.filter((r) => r.answers[oos.id] === "Yes").length : 0;
  const deliveryAnsweredAll = delivery ? rows.filter((r) => r.answers[delivery.id]) : [];
  const deliveredAll = delivery
    ? deliveryAnsweredAll.filter((r) => r.answers[delivery.id] === "Order Delivered").length
    : 0;
  const competitorAnsweredAll = competitor ? rows.filter((r) => r.answers[competitor.id]) : [];
  const competitorYesAll = competitor
    ? competitorAnsweredAll.filter((r) => r.answers[competitor.id] === "Yes").length
    : 0;

  const posDist: Record<string, number> = {};
  if (positioning) {
    for (const opt of positioning.options ?? []) posDist[opt] = 0;
    for (const r of rows) {
      const v = r.answers[positioning.id];
      if (v) posDist[v] = (posDist[v] ?? 0) + 1;
    }
  }

  const poDist: Record<string, number> = {};
  if (poStatus) {
    for (const r of rows) {
      const v = r.answers[poStatus.id];
      if (v) poDist[v] = (poDist[v] ?? 0) + 1;
    }
  }

  const deliveryDist: Record<string, number> = {};
  if (delivery) {
    for (const r of rows) {
      const v = r.answers[delivery.id];
      if (v) deliveryDist[v] = (deliveryDist[v] ?? 0) + 1;
    }
  }

  const daily: Record<string, number> = {};
  for (const r of rows) {
    const d = r.submittedAt.slice(0, 10);
    daily[d] = (daily[d] ?? 0) + 1;
  }
  const sortedDaily: Record<string, number> = {};
  for (const k of Object.keys(daily).sort()) sortedDaily[k] = daily[k];

  const oosLog = oos
    ? rows
        .filter((r) => r.answers[oos.id] === "Yes")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .map((r) => ({
          "Visit Date": r.submittedAt.slice(0, 10),
          "Merchandiser Name": merchandiser ? r.answers[merchandiser.id] ?? "" : "",
          "Retailer Name": retailer
            ? effectiveLabel(r.answers[retailer.id], retailerOther ? r.answers[retailerOther.id] : undefined)
            : "",
          "Retailer Location / Branch": location
            ? effectiveLabel(r.answers[location.id], locationOther ? r.answers[locationOther.id] : undefined)
            : "",
          Region: region ? r.answers[region.id] ?? "" : "",
          "OOS List Of Items": (oosItems ? r.answers[oosItems.id] : "") || "Not itemized",
        }))
    : [];

  const raw = rows
    .slice()
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .map((r) => {
      const d = new Date(r.submittedAt);
      return {
        "Visit Date": r.submittedAt.slice(0, 10),
        "Visit Time": d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
        "Merchandiser Name": merchandiser ? r.answers[merchandiser.id] ?? "" : "",
        "Merchandiser Code": r.merchandiserCode ?? "",
        "Retailer Name": retailer
          ? effectiveLabel(r.answers[retailer.id], retailerOther ? r.answers[retailerOther.id] : undefined)
          : "",
        Region: region ? r.answers[region.id] ?? "" : "",
        "Retailer Location / Branch": location
          ? effectiveLabel(r.answers[location.id], locationOther ? r.answers[locationOther.id] : undefined)
          : "",
        "Share of Shelf (%)": shelfPct ? parseFloat(r.answers[shelfPct.id]) || 0 : 0,
        "Out of Stock (OOS)": oos ? r.answers[oos.id] ?? "" : "",
        "Competitor Activity Present": competitor ? r.answers[competitor.id] ?? "" : "",
        "SKU Count": skus
          ? (r.answers[skus.id] ?? "").split(",").map((s) => s.trim()).filter(Boolean).length
          : 0,
        "Product Positioning (1 = worst, 5 = best)": positioning
          ? r.answers[positioning.id] ?? ""
          : "",
        "PO Status Clean": poStatus ? r.answers[poStatus.id] ?? "" : "",
        "Delivery Status": delivery ? r.answers[delivery.id] ?? "" : "",
      };
    });

  const photos =
    photo && location
      ? buildPhotoFeed(rows, photo.id, {
          location: location.id,
          locationOther: locationOther?.id,
          retailer: retailer?.id,
          retailerOther: retailerOther?.id,
        }).map((p) => ({
          url: p.url,
          outlet: p.outlet,
          retailer: p.retailer,
          date: p.submittedAt.slice(0, 10),
        }))
      : [];

  const dates = Object.keys(sortedDaily);
  const dateRangeLabel =
    dates.length > 0
      ? dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} – ${dates[dates.length - 1]}`
      : "—";

  return {
    kpis: {
      total_visits: total,
      avg_sos: avg(sosAll),
      oos_rate: oosAnsweredAll.length
        ? Math.round((oosYesAll / oosAnsweredAll.length) * 1000) / 10
        : 0,
      avg_pos: avg(posAll),
      delivery_rate: deliveryAnsweredAll.length
        ? Math.round((deliveredAll / deliveryAnsweredAll.length) * 1000) / 10
        : 0,
      competitor_rate: competitorAnsweredAll.length
        ? Math.round((competitorYesAll / competitorAnsweredAll.length) * 1000) / 10
        : 0,
      retailers: retailerGroups.size,
      branches: location
        ? new Set(
            rows.map((r) =>
              effectiveLabel(r.answers[location.id], locationOther ? r.answers[locationOther.id] : undefined)
            ).filter(Boolean)
          ).size
        : 0,
      regions: regionGroups.size,
    },
    merchNameKey: "Merchandiser Name",
    retailerNameKey: "Retailer Name",
    regionNameKey: "Region",
    merch: buildGroupRecords(merchGroups, groupIds).map((g) => toRecord(g, "Merchandiser Name")),
    retailer: buildGroupRecords(retailerGroups, groupIds).map((g) => toRecord(g, "Retailer Name")),
    region: buildGroupRecords(regionGroups, groupIds).map((g) => toRecord(g, "Region")),
    pos_dist: posDist,
    po_dist: poDist,
    delivery_dist: deliveryDist,
    daily: sortedDaily,
    oos_log: oosLog,
    raw,
    photos,
    dateRangeLabel,
  };
}
