// Computes the Unilever "Individual Sales Productivity" KPI card (Principal
// KPIs -> Unilever) directly from the Centegy Sales & Returns sync tables
// (SalesReturnLine, PjpSkuPerformance -- both exclusively Unilever data, see
// lib/salesReturnsControl.ts), combined with the admin-entered
// UnileverKpiTarget/UnileverAssortmentSku reference tables. Unlike the Mars
// principal-KPIs feature, there is no uploaded workbook behind this --
// everything here is either a live Centegy fact or an admin-maintained
// reference row.
//
// Several of the six KPIs the source report format shows have no reliable
// data source yet:
//   - ECO (Coverage) and Perfect Assortment need a true assigned-outlet
//     universe per PJP, independent of which outlets happened to transact.
//     Centegy's synced tables only ever carry outlets that already produced a
//     CASHMEMO document -- there's no separate "assigned but not yet
//     visited" log in what's synced today.
//   - Billing Productivity needs a "calls attempted" count independent of
//     billing; same gap as above (every logged row already implies a
//     document was raised).
//   - Geo-Match needs GPS/geofence data, which the current sync queries
//     (scripts/db-bridge/sales-returns/*Query.ts) never select.
// Rather than invent a percentage against an unknown denominator, those rows
// come back with status "pending" and a plain-language reason. Where a real
// synced count exists even without a universe (e.g. ECO's covered-outlet
// count from PjpSkuPerformance.ecoMtd), it's surfaced in `gaps` so the card
// isn't silently empty. Extend this file once a real outlet universe / GPS
// source is confirmed (see scripts/db-bridge/sales-returns/probe-schema.ts).

import { prisma } from "./db";
import { isKenyaWorkingDay } from "./kenyaBusinessCalendar";
import { SALES_RETURNS_BRANCH_LABELS } from "./salesReturnsControl";

export type UnileverKpiKey = "sales" | "perfectAssortment" | "eco" | "billingProductivity" | "lppc" | "geoMatch";

export interface UnileverKpiRow {
  key: UnileverKpiKey;
  label: string;
  targetLabel: string;
  targetValue: number | null;
  actualValue: number | null;
  actualLabel: string;
  unit: "percent" | "lines";
  gapLabel: string | null;
  status: "computed" | "pending";
  pendingReason?: string;
}

export interface UnileverPjpCard {
  distributor: string;
  distributorLabel: string;
  pjp: string;
  routeName: string;
  repName: string;
  month: string; // "YYYY-MM"
  monthLabel: string;
  asOf: string; // "YYYY-MM-DD"
  workingDaysElapsed: number;
  workingDaysTotal: number;
  sales: {
    actual: number;
    target: number | null;
    balance: number | null;
    achievementPct: number | null;
    pacePct: number;
  };
  kpis: UnileverKpiRow[];
  gaps: {
    ecoOutletsCovered: number | null;
    ecoOutletsUniverse: number | null;
    paOutletsQualifying: number | null;
    paOutletsTotal: number | null;
    skuLines: number;
    productiveCalls: number;
  };
  recoveryPriorities: string[];
}

// Policy thresholds -- business goals from the source report format, not
// derived from data.
const SALES_TARGET_PCT = 100;
const PA_TARGET_PCT = 70;
const ECO_TARGET_PCT = 98;
const BP_TARGET_PCT = 85;
const LPPC_TARGET = 10;
const GEO_MATCH_TARGET_PCT = 98;

const NO_UNIVERSE_REASON = "No confirmed outlet universe per PJP yet — every Centegy table synced today only carries outlets that already produced a document, not an assigned-but-not-visited roster.";
const NO_ATTEMPTED_CALLS_REASON = "No 'call attempted' log independent of billing exists in the synced Centegy data — every logged transaction already implies a document was raised.";
const NO_GPS_REASON = "GPS/geofence data isn't selected by the current Centegy sync queries yet — see scripts/db-bridge/sales-returns/probe-schema.ts.";

export interface ComputeUnileverKpiParams {
  month: string; // "YYYY-MM"
  distributor?: string | null;
  asOf?: Date;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [year, mo] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, mo - 1, 1));
  const end = new Date(Date.UTC(year, mo, 1));
  return { start, end };
}

function workingDayCounts(month: string, asOf: Date): { elapsed: number; total: number } {
  const { start, end } = monthRange(month);
  let elapsed = 0;
  let total = 0;
  for (let day = new Date(start); day < end; day = new Date(day.getTime() + 86_400_000)) {
    if (!isKenyaWorkingDay(day)) continue;
    total += 1;
    if (day <= asOf) elapsed += 1;
  }
  return { elapsed, total };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Most frequent value in a multiset, used to pick a display name (rep/route)
 * out of possibly-inconsistent per-row values within one PJP/month. */
function mode(counts: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function bump(counts: Map<string, number>, value: string) {
  if (!value) return;
  counts.set(value, (counts.get(value) ?? 0) + 1);
}

interface PjpAccumulator {
  distributor: string;
  pjp: string;
  routeNames: Map<string, number>;
  repNames: Map<string, number>;
  salesActual: number;
  skuLineKeys: Set<string>; // `${invoiceNo}|${sku}` for genuine sold lines
  productiveCallKeys: Set<string>; // `${customerCode}|${deliveryDate}`
  billedOutlets: Set<string>; // customerCode, any document
  outletSkuSets: Map<string, Set<string>>; // customerCode -> skus bought (sold lines only)
}

function emptyAccumulator(distributor: string, pjp: string): PjpAccumulator {
  return {
    distributor,
    pjp,
    routeNames: new Map(),
    repNames: new Map(),
    salesActual: 0,
    skuLineKeys: new Set(),
    productiveCallKeys: new Set(),
    billedOutlets: new Set(),
    outletSkuSets: new Map(),
  };
}

const SOLD_DOCUMENT_TYPES = new Set(["01", "06"]); // Invoice, Telesale -- excludes pure Credit for Returns rows

export async function computeUnileverKpiCards({ month, distributor, asOf = new Date() }: ComputeUnileverKpiParams): Promise<UnileverPjpCard[]> {
  const { start, end } = monthRange(month);
  const { elapsed, total } = workingDayCounts(month, asOf);
  const pacePct = total > 0 ? round1((elapsed / total) * 100) : 0;

  const [lines, targets, assortmentSkus, ecoRows] = await Promise.all([
    prisma.salesReturnLine.findMany({
      where: {
        deliveryDate: { gte: start, lt: end },
        route: { not: null },
        ...(distributor ? { storageLocation: distributor } : {}),
      },
      select: {
        storageLocation: true,
        route: true,
        routeName: true,
        salesRepName: true,
        customerCode: true,
        invoiceNo: true,
        sku: true,
        documentType: true,
        saleQtyPieces: true,
        netSale: true,
        deliveryDate: true,
      },
    }),
    prisma.unileverKpiTarget.findMany({
      where: { month: start, ...(distributor ? { distributor } : {}) },
    }),
    prisma.unileverAssortmentSku.findMany({ where: { active: true }, select: { sku: true } }),
    prisma.pjpSkuPerformance.findMany({
      where: { month: start, ...(distributor ? { distributor } : {}) },
      select: { distributor: true, pjp: true, ecoMtd: true },
    }),
  ]);

  const basket = new Set(assortmentSkus.map((row) => row.sku));

  const accumulators = new Map<string, PjpAccumulator>(); // key: `${distributor}|${pjp}`
  const accFor = (dist: string, pjp: string) => {
    const key = `${dist}|${pjp}`;
    let acc = accumulators.get(key);
    if (!acc) {
      acc = emptyAccumulator(dist, pjp);
      accumulators.set(key, acc);
    }
    return acc;
  };

  for (const line of lines) {
    if (!line.route) continue;
    const acc = accFor(line.storageLocation, line.route);
    bump(acc.routeNames, line.routeName);
    bump(acc.repNames, line.salesRepName);
    acc.salesActual += line.netSale;
    acc.billedOutlets.add(line.customerCode);

    if (SOLD_DOCUMENT_TYPES.has(line.documentType) && line.saleQtyPieces > 0) {
      acc.skuLineKeys.add(`${line.invoiceNo}|${line.sku}`);
      acc.productiveCallKeys.add(`${line.customerCode}|${line.deliveryDate.toISOString().slice(0, 10)}`);
      let skus = acc.outletSkuSets.get(line.customerCode);
      if (!skus) {
        skus = new Set();
        acc.outletSkuSets.set(line.customerCode, skus);
      }
      skus.add(line.sku);
    }
  }

  const targetByKey = new Map(targets.map((t) => [`${t.distributor}|${t.pjp}`, t.salesTarget]));
  const ecoByKey = new Map<string, number>();
  for (const row of ecoRows) {
    const key = `${row.distributor}|${row.pjp}`;
    ecoByKey.set(key, Math.max(ecoByKey.get(key) ?? 0, row.ecoMtd));
  }
  // A PJP might only appear in PjpSkuPerformance (no billed lines yet this
  // month) -- still worth a card so the ECO gap is visible.
  for (const row of ecoRows) accFor(row.distributor, row.pjp);

  const cards: UnileverPjpCard[] = [];
  for (const acc of accumulators.values()) {
    const key = `${acc.distributor}|${acc.pjp}`;
    const target = targetByKey.get(key) ?? null;
    const balance = target === null ? null : target - acc.salesActual;
    const achievementPct = target && target > 0 ? round1((acc.salesActual / target) * 100) : null;
    const lppc = acc.productiveCallKeys.size > 0 ? round1(acc.skuLineKeys.size / acc.productiveCallKeys.size) : null;
    const ecoCovered = ecoByKey.get(key) ?? null;

    let paQualifying: number | null = null;
    let paTotal: number | null = null;
    let paPct: number | null = null;
    if (basket.size > 0) {
      paTotal = acc.outletSkuSets.size;
      paQualifying = 0;
      for (const skus of acc.outletSkuSets.values()) {
        let hasAll = true;
        for (const requiredSku of basket) {
          if (!skus.has(requiredSku)) {
            hasAll = false;
            break;
          }
        }
        if (hasAll) paQualifying += 1;
      }
      paPct = paTotal > 0 ? round1((paQualifying / paTotal) * 100) : null;
    }

    const kpis: UnileverKpiRow[] = [
      {
        key: "sales",
        label: "Sales",
        targetLabel: `${SALES_TARGET_PCT}%`,
        targetValue: SALES_TARGET_PCT,
        actualValue: achievementPct,
        actualLabel: achievementPct === null ? "—" : `${achievementPct}%`,
        unit: "percent",
        gapLabel: achievementPct === null ? null : `${round1(achievementPct - SALES_TARGET_PCT)}pp`,
        status: achievementPct === null ? "pending" : "computed",
        pendingReason: achievementPct === null ? "No sales target uploaded for this PJP/month yet — set one at /admin/unilever-kpis." : undefined,
      },
      {
        key: "perfectAssortment",
        label: "Perfect Assortment",
        targetLabel: `${PA_TARGET_PCT}%`,
        targetValue: PA_TARGET_PCT,
        actualValue: paPct,
        actualLabel: paPct === null ? "—" : `${paPct}%`,
        unit: "percent",
        gapLabel: paPct === null ? null : `${round1(paPct - PA_TARGET_PCT)}pp`,
        status: paPct === null ? "pending" : "computed",
        pendingReason: paPct === null ? "No core SKU basket defined yet — add active SKUs at /admin/unilever-kpis." : undefined,
      },
      {
        key: "eco",
        label: "ECO (Coverage)",
        targetLabel: `${ECO_TARGET_PCT}%`,
        targetValue: ECO_TARGET_PCT,
        actualValue: null,
        actualLabel: ecoCovered === null ? "—" : `${ecoCovered} outlets covered`,
        unit: "percent",
        gapLabel: null,
        status: "pending",
        pendingReason: NO_UNIVERSE_REASON,
      },
      {
        key: "billingProductivity",
        label: "Billing Productivity",
        targetLabel: `${BP_TARGET_PCT}%`,
        targetValue: BP_TARGET_PCT,
        actualValue: null,
        actualLabel: "—",
        unit: "percent",
        gapLabel: null,
        status: "pending",
        pendingReason: NO_ATTEMPTED_CALLS_REASON,
      },
      {
        key: "lppc",
        label: "LPPC",
        targetLabel: String(LPPC_TARGET),
        targetValue: LPPC_TARGET,
        actualValue: lppc,
        actualLabel: lppc === null ? "—" : lppc.toFixed(2),
        unit: "lines",
        gapLabel: lppc === null ? null : `${round1(lppc - LPPC_TARGET)} lines`,
        status: lppc === null ? "pending" : "computed",
        pendingReason: lppc === null ? "No productive calls logged yet this month." : undefined,
      },
      {
        key: "geoMatch",
        label: "Geo-Match",
        targetLabel: `${GEO_MATCH_TARGET_PCT}%`,
        targetValue: GEO_MATCH_TARGET_PCT,
        actualValue: null,
        actualLabel: "—",
        unit: "percent",
        gapLabel: null,
        status: "pending",
        pendingReason: NO_GPS_REASON,
      },
    ];

    const recoveryPriorities: string[] = [];
    if (target !== null && balance !== null && balance > 0) {
      const remainingDays = total - elapsed;
      if (remainingDays > 0) recoveryPriorities.push(`Sales: KES ${Math.round(balance / remainingDays).toLocaleString("en-US")}/day for ${remainingDays} remaining day${remainingDays === 1 ? "" : "s"}.`);
      else recoveryPriorities.push(`Sales: KES ${Math.round(balance).toLocaleString("en-US")} short with no working days left this month.`);
    }
    if (lppc !== null && lppc < LPPC_TARGET) recoveryPriorities.push(`Improve billing conversion, assortment and LPPC — currently ${lppc.toFixed(2)} lines per productive call vs a target of ${LPPC_TARGET}.`);
    if (paPct !== null && paPct < PA_TARGET_PCT && paTotal !== null && paQualifying !== null) recoveryPriorities.push(`Recover ${paTotal - paQualifying} outlet${paTotal - paQualifying === 1 ? "" : "s"} to reach ${PA_TARGET_PCT}% Perfect Assortment.`);

    cards.push({
      distributor: acc.distributor,
      distributorLabel: SALES_RETURNS_BRANCH_LABELS[acc.distributor] ?? acc.distributor,
      pjp: acc.pjp,
      routeName: mode(acc.routeNames) || acc.pjp,
      repName: mode(acc.repNames) || "—",
      month,
      monthLabel: start.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }),
      asOf: asOf.toISOString().slice(0, 10),
      workingDaysElapsed: elapsed,
      workingDaysTotal: total,
      sales: { actual: acc.salesActual, target, balance, achievementPct, pacePct },
      kpis,
      gaps: {
        ecoOutletsCovered: ecoCovered,
        ecoOutletsUniverse: null,
        paOutletsQualifying: paQualifying,
        paOutletsTotal: paTotal,
        skuLines: acc.skuLineKeys.size,
        productiveCalls: acc.productiveCallKeys.size,
      },
      recoveryPriorities,
    });
  }

  return cards.sort((a, b) => a.routeName.localeCompare(b.routeName));
}
