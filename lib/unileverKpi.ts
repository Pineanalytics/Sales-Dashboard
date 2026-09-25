// Computes the Unilever "Individual Sales Productivity" KPI card (Principal
// KPIs -> Unilever) directly from the Centegy Sales & Returns sync tables
// (SalesReturnLine, JourneyPlanAssignment, MisKpiValue -- all exclusively
// Unilever data, see lib/salesReturnsControl.ts), combined with the
// admin-entered UnileverKpiTarget/UnileverAssortmentSku reference tables.
// Unlike the Mars principal-KPIs feature, there is no uploaded workbook
// behind this -- everything here is either a live Centegy fact or an
// admin-maintained reference row.
//
// ECO, Billing Productivity, LPPC and Geo-Match all come from MisKpiValue --
// Centegy's own pre-computed PJP KPIs (its "FCS6" scoring module and "EDGC"
// EFOS geofence module), discovered and wired in 2026-09-25 after finding
// them more authoritative than deriving these by hand. See
// scripts/db-bridge/sales-returns/misKpiQuery.ts for exactly which KPI_IDs
// and why "JCNO" is the calendar month, not a week. Perfect Assortment isn't
// in Centegy's KPI catalog at all, so it's still derived here, from
// JourneyPlanAssignment (sourced from IG_I_JourneyPlan -- the only synced
// table that carries an outlet whether or not it has ever billed) combined
// with the admin-entered SKU basket. Geo-Match is real now, not
// hypothetical: Centegy's own geofence check (EDGCR01/02, rolled up to MTD
// in misKpiQuery.ts) currently matches 0% of scheduled outlets on every
// sampled day on both branches (2026-09-25) -- shown as a real 0%, not
// "pending", since it's a genuine (if bad) signal that geofencing isn't
// working in the field, not a gap in this sync.

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
    bpCallsBilled: number | null;
    bpCallsTotal: number | null;
    skuLines: number;
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

const NO_ROSTER_REASON = "No journey-plan roster synced yet for this PJP — the outlet-universe sync may not have reached it yet.";
const NO_MIS_KPI_REASON = "Centegy hasn't computed this KPI for this PJP/month yet — the MIS KPI sync may not have reached it yet.";

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
  outletSkuSets: Map<string, Set<string>>; // customerCode -> skus bought (sold lines only)
  journeyPlanUniverse: Set<string>; // customerCode, from JourneyPlanAssignment
  misKpi: Map<string, number>; // kpiId -> value, from MisKpiValue
}

function emptyAccumulator(distributor: string, pjp: string): PjpAccumulator {
  return {
    distributor,
    pjp,
    routeNames: new Map(),
    repNames: new Map(),
    salesActual: 0,
    skuLineKeys: new Set(),
    outletSkuSets: new Map(),
    journeyPlanUniverse: new Set(),
    misKpi: new Map(),
  };
}

const SOLD_DOCUMENT_TYPES = new Set(["01", "06"]); // Invoice, Telesale -- excludes pure Credit for Returns rows

export async function computeUnileverKpiCards({ month, distributor, asOf = new Date() }: ComputeUnileverKpiParams): Promise<UnileverPjpCard[]> {
  const { start, end } = monthRange(month);
  const { elapsed, total } = workingDayCounts(month, asOf);
  const pacePct = total > 0 ? round1((elapsed / total) * 100) : 0;

  const [year, jcno] = month.split("-");

  const [lines, targets, assortmentSkus, journeyPlanRows, misKpiRows] = await Promise.all([
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
      },
    }),
    prisma.unileverKpiTarget.findMany({
      where: { month: start, ...(distributor ? { distributor } : {}) },
    }),
    prisma.unileverAssortmentSku.findMany({ where: { active: true }, select: { sku: true } }),
    // Current roster, not month-scoped -- see JourneyPlanAssignment's own comment.
    prisma.journeyPlanAssignment.findMany({
      where: distributor ? { distributor } : {},
      select: { distributor: true, pjp: true, customerCode: true },
    }),
    prisma.misKpiValue.findMany({
      where: { year, jcno, ...(distributor ? { distributor } : {}) },
      select: { distributor: true, pjp: true, kpiId: true, value: true },
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

    if (SOLD_DOCUMENT_TYPES.has(line.documentType) && line.saleQtyPieces > 0) {
      acc.skuLineKeys.add(`${line.invoiceNo}|${line.sku}`);
      let skus = acc.outletSkuSets.get(line.customerCode);
      if (!skus) {
        skus = new Set();
        acc.outletSkuSets.set(line.customerCode, skus);
      }
      skus.add(line.sku);
    }
  }

  const targetByKey = new Map(targets.map((t) => [`${t.distributor}|${t.pjp}`, t.salesTarget]));
  // A PJP might only appear in one of these companion sources (e.g. no
  // billed lines yet this month, but a roster or MIS KPI row already synced)
  // -- still worth a card so its gap is visible.
  for (const row of journeyPlanRows) accFor(row.distributor, row.pjp).journeyPlanUniverse.add(row.customerCode);
  for (const row of misKpiRows) accFor(row.distributor, row.pjp).misKpi.set(row.kpiId, row.value);

  const cards: UnileverPjpCard[] = [];
  for (const acc of accumulators.values()) {
    const key = `${acc.distributor}|${acc.pjp}`;
    const target = targetByKey.get(key) ?? null;
    const balance = target === null ? null : target - acc.salesActual;
    const achievementPct = target && target > 0 ? round1((acc.salesActual / target) * 100) : null;

    const misVal = (kpiId: string) => acc.misKpi.get(kpiId) ?? null;

    const ecoUniverse = misVal("FCS6ECR1");
    const ecoCovered = misVal("FCS6ECR2");
    const ecoPct = misVal("FCS6ECR3");
    const ecoTargetPct = misVal("FCS6ECR4") ?? ECO_TARGET_PCT;

    const bpTotal = misVal("FCS6BPR1");
    const bpBilled = misVal("FCS6BPR2");
    const bpPct = misVal("FCS6BPR3");
    const bpTargetPct = misVal("FCS6BPR4") ?? BP_TARGET_PCT;

    const lppcTarget = misVal("FCS6LPR3") ?? LPPC_TARGET;
    const lppcAchRatioPct = misVal("FCS6LPR5");
    // Centegy exposes the achievement ratio (Actual/Target), not the raw
    // LPPC value directly -- back it out from the ratio and target.
    const lppc = lppcAchRatioPct !== null ? round1((lppcAchRatioPct / 100) * lppcTarget) : null;

    const geoPct = misVal("GEOCODE_MATCHED_PCT_MTD");

    let paQualifying: number | null = null;
    let paTotal: number | null = null;
    let paPct: number | null = null;
    if (basket.size > 0 && acc.journeyPlanUniverse.size > 0) {
      paTotal = acc.journeyPlanUniverse.size;
      paQualifying = 0;
      for (const customerCode of acc.journeyPlanUniverse) {
        const skus = acc.outletSkuSets.get(customerCode);
        if (skus && [...basket].every((requiredSku) => skus.has(requiredSku))) paQualifying += 1;
      }
      paPct = round1((paQualifying / paTotal) * 100);
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
        pendingReason: paPct === null ? (basket.size === 0 ? "No core SKU basket defined yet — add active SKUs at /admin/unilever-kpis." : NO_ROSTER_REASON) : undefined,
      },
      {
        key: "eco",
        label: "ECO (Coverage)",
        targetLabel: `${ecoTargetPct}%`,
        targetValue: ecoTargetPct,
        actualValue: ecoPct,
        actualLabel: ecoPct === null ? "—" : `${ecoPct}%`,
        unit: "percent",
        gapLabel: ecoPct === null ? null : `${round1(ecoPct - ecoTargetPct)}pp`,
        status: ecoPct === null ? "pending" : "computed",
        pendingReason: ecoPct === null ? NO_MIS_KPI_REASON : undefined,
      },
      {
        key: "billingProductivity",
        label: "Billing Productivity",
        targetLabel: `${bpTargetPct}%`,
        targetValue: bpTargetPct,
        actualValue: bpPct,
        actualLabel: bpPct === null ? "—" : `${bpPct}%`,
        unit: "percent",
        gapLabel: bpPct === null ? null : `${round1(bpPct - bpTargetPct)}pp`,
        status: bpPct === null ? "pending" : "computed",
        pendingReason: bpPct === null ? NO_MIS_KPI_REASON : undefined,
      },
      {
        key: "lppc",
        label: "LPPC",
        targetLabel: String(lppcTarget),
        targetValue: lppcTarget,
        actualValue: lppc,
        actualLabel: lppc === null ? "—" : lppc.toFixed(2),
        unit: "lines",
        gapLabel: lppc === null ? null : `${round1(lppc - lppcTarget)} lines`,
        status: lppc === null ? "pending" : "computed",
        pendingReason: lppc === null ? NO_MIS_KPI_REASON : undefined,
      },
      {
        key: "geoMatch",
        label: "Geo-Match",
        targetLabel: `${GEO_MATCH_TARGET_PCT}%`,
        targetValue: GEO_MATCH_TARGET_PCT,
        actualValue: geoPct,
        actualLabel: geoPct === null ? "—" : `${geoPct}%`,
        unit: "percent",
        gapLabel: geoPct === null ? null : `${round1(geoPct - GEO_MATCH_TARGET_PCT)}pp`,
        status: geoPct === null ? "pending" : "computed",
        pendingReason: geoPct === null ? NO_MIS_KPI_REASON : undefined,
      },
    ];

    const recoveryPriorities: string[] = [];
    if (target !== null && balance !== null && balance > 0) {
      const remainingDays = total - elapsed;
      if (remainingDays > 0) recoveryPriorities.push(`Sales: KES ${Math.round(balance / remainingDays).toLocaleString("en-US")}/day for ${remainingDays} remaining day${remainingDays === 1 ? "" : "s"}.`);
      else recoveryPriorities.push(`Sales: KES ${Math.round(balance).toLocaleString("en-US")} short with no working days left this month.`);
    }
    if (ecoPct !== null && ecoPct < ecoTargetPct && ecoUniverse !== null && ecoCovered !== null) {
      const gap = Math.round(ecoUniverse - ecoCovered);
      if (gap > 0) recoveryPriorities.push(`Recover ${gap} additional outlet${gap === 1 ? "" : "s"} to reach ${ecoTargetPct}% ECO.`);
    }
    if (lppc !== null && lppc < lppcTarget) recoveryPriorities.push(`Improve billing conversion, assortment and LPPC — currently ${lppc.toFixed(2)} lines per productive call vs a target of ${lppcTarget}.`);
    if (paPct !== null && paPct < PA_TARGET_PCT && paTotal !== null && paQualifying !== null) recoveryPriorities.push(`Recover ${paTotal - paQualifying} outlet${paTotal - paQualifying === 1 ? "" : "s"} to reach ${PA_TARGET_PCT}% Perfect Assortment.`);
    if (bpPct !== null && bpPct < bpTargetPct) recoveryPriorities.push(`Improve billing conversion — currently ${bpPct}% of scheduled calls result in a sale, vs a target of ${bpTargetPct}%.`);
    if (geoPct !== null && geoPct < GEO_MATCH_TARGET_PCT) recoveryPriorities.push(`Validate GPS exceptions — Geo-Match is at ${geoPct}% against a ${GEO_MATCH_TARGET_PCT}% target.`);

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
        ecoOutletsUniverse: ecoUniverse,
        paOutletsQualifying: paQualifying,
        paOutletsTotal: paTotal,
        bpCallsBilled: bpBilled,
        bpCallsTotal: bpTotal,
        skuLines: acc.skuLineKeys.size,
      },
      recoveryPriorities,
    });
  }

  return cards.sort((a, b) => a.routeName.localeCompare(b.routeName));
}
