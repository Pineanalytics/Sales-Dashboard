// Replicates Principal_CostCentre_Fact.m's enrichment chain (SKU-prefix Cost Centre
// resolution, nosale rep-modal-CC inference, SalesRole derivation, ProductiveFlag),
// then appends "-Nairobi" (per the user: everything from this system is
// Nairobi-based), applies the same fixup list already used for YTD_Raw, matches
// against principals.json, and collapses to distinct-outlet counts per
// Year+Month+SalesRole+Employee+CostCentre — the grain MonthlyCoverageRow expects.
//
// Deliberately NOT gated by the M script's global ActivityStatus (active-as-of a
// single END_DATE snapshot) — that's the right concept for "should this outlet
// still count at all," but the wrong grain for a monthly trend: a single global
// snapshot would distort earlier months. Coverage/productive here are computed
// per month from that month's own rows only.
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { MonthlyCoverageRow } from "@/lib/types";
import type { PineFactRow } from "./query";

export interface PrincipalRow {
  key: string;
  principal: string;
  mainPrincipal: string;
  location: string;
  locationCode: string;
  status: string;
  teamLeader: string;
}

const SALE_TYPES = new Set(["sale", "sale_return", "order", "order_return"]);
const PRODUCTIVE_TYPES = new Set(["sale", "order"]);
const MARS_CC = "mars";

// Longest-prefix-first, so "UP" (Upfield) never shadows a longer prefix that
// happens to start the same way — same rule as the source M query's PrincipalMap.
const PRINCIPAL_MAP_UNSORTED: [string, string][] = [
  ["Bic", "BIC"],
  ["Delmonte", "DEL"],
  ["DKT", "DKT"],
  ["Durex", "DUREX"],
  ["EABL", "KBL"],
  ["EFL", "CEY"],
  ["Energia", "EPL"],
  ["General", "ELX"],
  ["Godrej", "GDJ"],
  ["Jumra", "JMR"],
  ["Mars", "MARS"],
  ["Movit", "MOV"],
  ["Nestle", "NES"],
  ["Premier", "PREM"],
  ["Promasidor", "PROM"],
  ["Signify", "SIG"],
  ["Suntory", "SUN"],
  ["Tropikal", "TPL"],
  ["Ukl-Intl.", "KMFY"],
  ["Unilever", "UKL"],
  ["Upfield", "UP"],
  ["Weetabix", "WEET"],
];
const PRINCIPAL_MAP: [string, string][] = [...PRINCIPAL_MAP_UNSORTED].sort((a, b) => b[1].length - a[1].length);

function resolveBrandFromSku(skuUpper: string): string {
  const match = PRINCIPAL_MAP.find(([, prefix]) => skuUpper.startsWith(prefix));
  return match ? match[0] : "";
}

// Same fixup list as scripts/db-bridge/transform/buildMonthlySales.ts's
// YTD_RAW_FIXUPS — duplicated locally rather than imported, matching this
// codebase's existing precedent (e.g. reference/products.ts).
const NAIROBI_FIXUPS: [string, string][] = [
  ["EABL-Nairobi", "EABL-Nyahururu"],
  ["Premier-Machakos", "Premier-Nairobi"],
  ["Suntory-Machakos", "Suntory-Nairobi"],
  ["Suntory-Nyahururu", "Suntory-Nairobi"],
];

function applyFixups(key: string): string {
  for (const [from, to] of NAIROBI_FIXUPS) {
    if (key === from) return to;
  }
  return key;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function monthStart(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface TransformResult {
  rows: MonthlyCoverageRow[];
  unmatchedCostCentres: string[];
}

export function buildCoverage(rawRows: PineFactRow[], principals: PrincipalRow[]): TransformResult {
  const activePrincipalByKey = new Map(
    principals.filter((p) => p.status === "Active").map((p) => [p.principal, p])
  );

  // ── Resolve raw brand (pre-Nairobi-suffix, pre-fixup) per row from the SKU code ──
  const brandRaw = rawRows.map((r) => (r.sapCode ? resolveBrandFromSku(r.sapCode.trim().toUpperCase()) : ""));

  // ── Nosale rep-modal-CC inference: each rep's most common resolved brand that month ──
  const repMonthCounts = new Map<string, Map<string, number>>(); // "userId|monthKey" -> brand -> count
  rawRows.forEach((r, i) => {
    if (!SALE_TYPES.has(r.type) || !brandRaw[i]) return;
    const key = `${r.userId}|${monthStart(r.date)}`;
    if (!repMonthCounts.has(key)) repMonthCounts.set(key, new Map());
    const counts = repMonthCounts.get(key)!;
    counts.set(brandRaw[i], (counts.get(brandRaw[i]) ?? 0) + 1);
  });
  const repMonthModal = new Map<string, string>();
  for (const [key, counts] of repMonthCounts) {
    let best = "";
    let bestCount = -1;
    for (const [brand, count] of counts) {
      if (count > bestCount) {
        best = brand;
        bestCount = count;
      }
    }
    repMonthModal.set(key, best);
  }

  // ── Resolve final CostCentre (brand) per row: direct match, or rep-modal for nosale ──
  const unmatched = new Set<string>();
  interface Row {
    year: string;
    month: string;
    monthIndex: number;
    salesRole: string;
    employeeName: string;
    principal: string;
    customerId: string;
    productive: boolean;
  }
  const enriched: Row[] = [];

  rawRows.forEach((r, i) => {
    if (!r.customerId) return;

    const isSale = SALE_TYPES.has(r.type);
    const direct = brandRaw[i];
    const inferred = !isSale ? repMonthModal.get(`${r.userId}|${monthStart(r.date)}`) ?? "" : "";
    const brand = direct || inferred;
    if (!brand) return; // unresolvable (M code's UNMAPPED_LABEL) — nothing to attribute coverage to

    // Nairobi suffix (per the user: everything from this system is Nairobi-based).
    // Strip trailing punctuation first — the source PrincipalMap's "Ukl-Intl." has
    // a trailing period that principals.json's "Ukl-Intl-Nairobi" doesn't.
    const cleanedBrand = brand.trim().replace(/\.$/, "");
    const rawKey = `${cleanedBrand}-Nairobi`;
    const fixedKey = applyFixups(rawKey);

    const principalRow = activePrincipalByKey.get(fixedKey);
    if (!principalRow) {
      unmatched.add(fixedKey);
      return;
    }

    const userGroup = (r.userGroup ?? "").trim().toUpperCase();
    const isMars = cleanedBrand.toLowerCase() === MARS_CC;
    const salesRole = userGroup === "MBSR" || (userGroup === "TDR" && isMars) ? "Secondary Sales" : "Primary Sales";

    const productive = PRODUCTIVE_TYPES.has(r.type) && r.revenue > 0 && r.qty > 0;

    enriched.push({
      year: String(r.date.getUTCFullYear()),
      month: CANONICAL_MONTHS[r.date.getUTCMonth()],
      monthIndex: r.date.getUTCMonth(),
      salesRole,
      // Trimmed — the source has both "Charles Mutambuki" and "Charles Mutambuki "
      // (trailing space) for the same person, which would otherwise silently split
      // one rep into two rows in the by-rep grouping below.
      employeeName: r.employee.trim(),
      principal: principalRow.principal,
      customerId: r.customerId,
      productive,
    });
  });

  // ── Collapse to Year+Month+SalesRole+Employee+CostCentre, counting distinct outlets ──
  interface Agg {
    year: string;
    month: string;
    monthIndex: number;
    salesRole: string;
    employeeName: string;
    principal: string;
    customers: Set<string>;
    productiveCustomers: Set<string>;
  }
  const byKey = new Map<string, Agg>();
  for (const r of enriched) {
    const key = `${r.year}|${r.month}|${r.salesRole}|${r.employeeName}|${r.principal}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        year: r.year,
        month: r.month,
        monthIndex: r.monthIndex,
        salesRole: r.salesRole,
        employeeName: r.employeeName,
        principal: r.principal,
        customers: new Set(),
        productiveCustomers: new Set(),
      };
      byKey.set(key, agg);
    }
    agg.customers.add(r.customerId);
    if (r.productive) agg.productiveCustomers.add(r.customerId);
  }

  const rows: MonthlyCoverageRow[] = Array.from(byKey.values()).map((agg) => ({
    year: agg.year,
    month: agg.month,
    monthIndex: agg.monthIndex,
    salesRole: agg.salesRole,
    employeeName: agg.employeeName,
    principal: agg.principal,
    principalKey: normalizePrincipalKey(agg.principal),
    coverage: agg.customers.size,
    productiveCalls: agg.productiveCustomers.size,
    productivityPct: agg.customers.size > 0 ? round1((agg.productiveCustomers.size / agg.customers.size) * 100) : 0,
  }));

  return { rows, unmatchedCostCentres: Array.from(unmatched) };
}
