// The Reckitt universe for the Active Outlets module: every shop that bought in the last six calendar months (this month included, so far), once, with how
// steadily it bought, Direct or Indirect, and whether it falls in the universe selected for Reckitt. It is built from the same shops and purchase days as the
// coverage frequency extract (lib/outletUniverse/frequency.ts: the cleanup applied, one row per shop, the same name profiles and tiering), so a segment, a tier
// or a count reads here as it does there. What differs is the window (six calendar months, not a year, quarter, month or week) and the tenure rules below.
//
// Buying tenure, one per shop, the strictest it kept up in the six months:
//   Once Per Month   bought in every one of the six months (the month in progress counts from its first day);
//   Once in 3 Months bought at least once in the last three months, but not in every month;
//   Once in 6 Months bought in the six months, but not in the last three.
// Total Distinct Coverage is the shops across the three, each counted once, which is every shop that bought in the window.
//
// Direct is Primary Sales and Indirect everything else (the Active Outlets rule: Primary + Secondary counts as Primary).
//
// The selected universe is the part of the entire universe that could stock the Reckitt portfolio and buys at a worthwhile size: a segment Reckitt can sell
// into, spending more than KSh 20,000 a purchase (wholesalers) or KSh 1,000 a purchase (every other segment). Beauty Shop, Pharmacies, Baby Shop and Institutions are
// the direct suites by relevance: they are always in, whatever they spend. Strike rate and location / shopper profile are not applied: they are not measured per
// outlet in the extract.
import { nairobiToday } from "@/lib/financePresentation";
import { OUTLET_ACTIVE_WINDOW_DAYS } from "./normalize";
import { loadFrequencyOutlets, type FrequencyOutlet, type FrequencyPeriod } from "./frequency";
import type { OutletFilters, OutletScope } from "./query";

import { RECKITT_TENURES, type ReckittTenure } from "./reckittTenures";

export { RECKITT_TENURES, type ReckittTenure };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The Segment / Type groups the source systems' own segment names fall into, as restructured in the Reckitt Universe Analysis template (each source segment goes to
 *  the group it went to in 88 to 100% of that template's rows; the rest were shops sharing a name with a bigger seller, which the tiering already handles). */
export const SEGMENT_GROUPS: Record<string, readonly string[]> = {
  Retailers: ["Retailers", "Shop", "Kiosk", "Small Duka", "Large Duka", "Other"],
  Wholesalers: ["Wholesalers", "Minimart", "Mini Mart/t3 Store", "Distributor", "Hyper"],
  LMT: ["Supermarkets", "Large Modern Trade", "LMT"],
  Horeca: ["Horeca", "Bar", "Hotel", "Lodging", "Marketplace", "Nightclub", "Event", "Recreation", "Restaurant"],
  "Wines & Spirits": ["Specialist Store", "Wines & Spirits"],
  "Baby Shop": ["Baby Shop"],
  "Beauty Shop": ["Beauty Shop"],
  "Liquor Shops": ["Liquor Shops"],
  Pharmacies: ["Pharmacies"],
  Institutions: ["Institutions"],
  Export: ["Export"],
};

const GROUP_OF = new Map(Object.entries(SEGMENT_GROUPS).flatMap(([group, members]) => members.map((m) => [m.toLowerCase(), group] as const)));

/** The restructured Segment / Type of a source segment name; a name that is in no group is kept as it is, so nothing is hidden. */
export function restructureSegment(segment: string): string {
  const trimmed = segment.trim();
  return GROUP_OF.get(trimmed.toLowerCase()) ?? trimmed;
}

/** The window length, in calendar months, counting the month in progress. */
export const RECKITT_WINDOW_MONTHS = 6;

/** Segments Reckitt (household, health and baby care) can sell into; everything else (horeca, liquor, wines and spirits, export, ...) cannot stock its portfolio. */
export const RECKITT_SEGMENTS = ["Baby Shop", "Beauty Shop", "Institutions", "LMT", "Pharmacies", "Retailers", "Wholesalers"] as const;
/** Segments that fit the Reckitt portfolio by their nature (direct suites by relevance): selected whatever the shop spends, even with no average on record. */
export const RECKITT_RELEVANT_SEGMENTS = ["Baby Shop", "Beauty Shop", "Institutions", "Pharmacies"] as const;
/** Spend per purchase every other eligible shop must exceed, in KSh: wholesalers, and the rest. */
export const RECKITT_WHOLESALE_MIN = 20_000;
export const RECKITT_RETAIL_MIN = 1_000;
const WHOLESALE_SEGMENT = "wholesalers";

/** The six calendar months ending with the current one, as a frequency period (start inclusive, end exclusive, `startedMonths` in order, oldest first). */
export function reckittWindow(now: Date = new Date()): FrequencyPeriod {
  const today = nairobiToday(now);
  const start = new Date(Date.UTC(today.year, today.monthIndex - (RECKITT_WINDOW_MONTHS - 1), 1));
  const end = new Date(Date.UTC(today.year, today.monthIndex + 1, 1));
  const startedMonths = Array.from({ length: RECKITT_WINDOW_MONTHS }, (_, i) => (start.getUTCMonth() + i) % 12);
  const fmt = (d: Date) => `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return { kind: "month", year: today.year, quarter: null, month: null, week: null, start, end, label: `${fmt(start)} to ${fmt(new Date(end.getTime() - 86_400_000))}`, startedMonths };
}

/** The window's months, oldest first, as a calendar month index (0 to 11) and a label such as "May 2026". */
export function reckittMonths(window: Pick<FrequencyPeriod, "start" | "startedMonths">): { index: number; label: string }[] {
  return window.startedMonths.map((index, i) => {
    const d = new Date(Date.UTC(window.start.getUTCFullYear(), window.start.getUTCMonth() + i, 1));
    return { index, label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
  });
}

/** The tenure of a shop from the days it bought on in each calendar month (index 0 = January); null when it did not buy in the window. */
export function reckittTenure(daysByMonth: readonly number[], window: Pick<FrequencyPeriod, "startedMonths">): ReckittTenure | null {
  const months = window.startedMonths;
  const bought = (m: number) => (daysByMonth[m] ?? 0) > 0;
  if (!months.some(bought)) return null;
  if (months.every(bought)) return "Once Per Month";
  if (months.slice(-3).some(bought)) return "Once in 3 Months";
  return "Once in 6 Months";
}

/** Whether a shop is in the universe selected for Reckitt, and why or why not. `spend` is the outlet's combined average per purchase, which its tier is read from. */
export function reckittSelection(segment: string, spend: number | null): { selected: boolean; basis: string } {
  const eligible = (RECKITT_SEGMENTS as readonly string[]).some((s) => s.toLowerCase() === segment.trim().toLowerCase());
  if (!eligible) return { selected: false, basis: "Segment cannot stock the Reckitt portfolio" };
  if ((RECKITT_RELEVANT_SEGMENTS as readonly string[]).some((s) => s.toLowerCase() === segment.trim().toLowerCase())) return { selected: true, basis: "Relevant segment: included whatever the spend" };
  if (spend === null) return { selected: false, basis: "No average spend on record" };
  const wholesale = segment.trim().toLowerCase() === WHOLESALE_SEGMENT;
  const minimum = wholesale ? RECKITT_WHOLESALE_MIN : RECKITT_RETAIL_MIN;
  const limit = `KSh ${minimum.toLocaleString("en-US")} per purchase`;
  return spend > minimum
    ? { selected: true, basis: wholesale ? `Wholesaler above ${limit}` : `Above ${limit}` }
    : { selected: false, basis: wholesale ? `Wholesaler at or below ${limit}` : `At or below ${limit}` };
}

export interface ReckittOutlet extends FrequencyOutlet {
  tenure: ReckittTenure;
  /** The Segment / Type (restructured, the highlighted column) differs from the segment the shop's source system gave. */
  segmentRestructured: boolean;
  /** Bought in the Active Outlets module's activity window (90 days). */
  active: boolean;
  selected: boolean;
  selectionBasis: string;
  /** Purchase days in each of the window's months, oldest first. */
  windowDays: number[];
}

export interface ReckittReport {
  window: FrequencyPeriod;
  months: { index: number; label: string }[];
  /** The entire universe: every shop that bought in the window. */
  outlets: ReckittOutlet[];
  systemOutlets: number;
  duplicatesMerged: number;
  generatedAt: string;
}

/** The first date that still counts as active: the start of the day 90 days back, as the cleanup module and the Active Outlets extract judge it. */
function activeCutoff(now: Date): string {
  const today = nairobiToday(now);
  return new Date(Date.UTC(today.year, today.monthIndex, today.day - OUTLET_ACTIVE_WINDOW_DAYS)).toISOString().slice(0, 10);
}

/** The Reckitt rows from the frequency extract's shops in the window. Pure so it can be tested without a database. */
export function buildReckittOutlets(shops: FrequencyOutlet[], window: FrequencyPeriod, now: Date = new Date()): ReckittOutlet[] {
  const months = reckittMonths(window);
  const cutoff = activeCutoff(now);
  const out: ReckittOutlet[] = [];
  for (const shop of shops) {
    const tenure = reckittTenure(shop.daysByMonth, window);
    if (!tenure) continue;
    const segment = restructureSegment(shop.segment);
    const selection = reckittSelection(segment, shop.combinedAverage ?? shop.averageSales);
    out.push({
      ...shop,
      segment,
      tenure,
      segmentRestructured: segment.toLowerCase() !== shop.sourceSegment.trim().toLowerCase(),
      active: shop.lastPurchase >= cutoff,
      selected: selection.selected,
      selectionBasis: selection.basis,
      windowDays: months.map((m) => shop.daysByMonth[m.index] ?? 0),
    });
  }
  return out;
}

/** Every shop that bought in the last six months, with its tenure, Direct / Indirect and Reckitt selection. Narrowed by the same filters as the Active Outlets screen. */
export async function loadReckittReport(filters: OutletFilters, scope: OutletScope, now: Date = new Date()): Promise<ReckittReport> {
  const window = reckittWindow(now);
  const { outlets: shops, systemOutlets } = await loadFrequencyOutlets(window, filters, scope);
  const outlets = buildReckittOutlets(shops, window, now);
  return { window, months: reckittMonths(window), outlets, systemOutlets, duplicatesMerged: systemOutlets - shops.length, generatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/** The summary's Segment / Type rows, in order; a segment found in the data that is not listed is added after them, sorted. */
export const RECKITT_SEGMENT_ROWS = ["Baby Shop", "Beauty Shop", "Horeca", "Institutions", "Liquor Shops", "LMT", "Pharmacies", "Retailers", "Wholesalers", "Wines & Spirits", "Export"] as const;

/** The summary's region rows: the three the business runs, then any other found (Coast, Western, ... and Others). */
export const RECKITT_REGION_ROWS = ["Nairobi", "Mountain", "Eastern"] as const;

export interface ReckittRow {
  label: string;
  counts: Record<ReckittTenure, number>;
  /** Total Distinct Coverage: the three tenures added. */
  total: number;
}

export interface ReckittTable {
  title: string;
  rowHeader: string;
  rows: ReckittRow[];
  total: ReckittRow;
}

const emptyCounts = (): Record<ReckittTenure, number> => ({ "Once in 6 Months": 0, "Once in 3 Months": 0, "Once Per Month": 0 });

/** Row labels: the listed ones first (always shown), then any others present, alphabetically. */
export function rowLabels(listed: readonly string[], present: Iterable<string>): string[] {
  const seen = new Set(listed.map((l) => l.toLowerCase()));
  const extras: string[] = [];
  for (const label of present) {
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    extras.push(label);
  }
  return [...listed, ...extras.sort((a, b) => a.localeCompare(b))];
}

/** `weight` counts something other than shops per row, e.g. the system outlets a shop is made of. */
export function reckittTable(title: string, rowHeader: string, labels: readonly string[], items: ReckittOutlet[], group: (o: ReckittOutlet) => string, weight: (o: ReckittOutlet) => number = () => 1): ReckittTable {
  const rows: ReckittRow[] = labels.map((label) => ({ label, counts: emptyCounts(), total: 0 }));
  const byLabel = new Map(rows.map((r) => [r.label.toLowerCase(), r]));
  for (const o of items) {
    const row = byLabel.get(group(o).toLowerCase());
    if (!row) continue;
    row.counts[o.tenure] += weight(o);
    row.total += weight(o);
  }
  const total: ReckittRow = { label: "Grand Total", counts: emptyCounts(), total: 0 };
  for (const row of rows) {
    for (const t of RECKITT_TENURES) total.counts[t] += row.counts[t];
    total.total += row.total;
  }
  return { title, rowHeader, rows, total };
}

export interface ReckittSummary {
  /** The entire universe and the selected one, each by Segment / Type, then Direct and Indirect by Segment / Type and by region. */
  entire: UniverseTables;
  selected: UniverseTables;
  /** The active universe: the shops that bought in the last 90 days (the dashboard's Active outlets), by the same tables. */
  active: UniverseTables;
  /** The active universe counted in system outlets rather than distinct shops, Direct and Indirect by tenure: the basis of the Outlet Cleanup "Active outlets" tile. */
  activeOutlets: ReckittTable;
  /** Direct, Indirect and total shops of the selected universe by segment: the "Recommended coverage for Reckitt" table. */
  recommended: { label: string; direct: number; indirect: number; total: number }[];
}

export interface UniverseTables {
  all: ReckittTable;
  directSegment: ReckittTable;
  indirectSegment: ReckittTable;
  directRegion: ReckittTable;
  indirectRegion: ReckittTable;
}

function universeTables(prefix: string, items: ReckittOutlet[], segments: string[], regions: string[]): UniverseTables {
  const direct = items.filter((o) => o.classification === "Direct");
  const indirect = items.filter((o) => o.classification === "Indirect");
  const bySegment = (o: ReckittOutlet) => o.segment;
  const byRegion = (o: ReckittOutlet) => o.regionGroup;
  return {
    all: reckittTable(`${prefix} - Total coverage`, "Segment / Type", segments, items, bySegment),
    directSegment: reckittTable(`${prefix} - Direct`, "Segment / Type", segments, direct, bySegment),
    indirectSegment: reckittTable(`${prefix} - Indirect`, "Segment / Type", segments, indirect, bySegment),
    directRegion: reckittTable(`${prefix} - Direct by region`, "Region", regions, direct, byRegion),
    indirectRegion: reckittTable(`${prefix} - Indirect by region`, "Region", regions, indirect, byRegion),
  };
}

export function buildReckittSummary(outlets: ReckittOutlet[]): ReckittSummary {
  const segments = rowLabels(RECKITT_SEGMENT_ROWS, outlets.map((o) => o.segment));
  const regions = rowLabels(RECKITT_REGION_ROWS, outlets.map((o) => o.regionGroup));
  const selected = outlets.filter((o) => o.selected);
  const recommended = RECKITT_SEGMENTS.map((label) => {
    const inSegment = selected.filter((o) => o.segment.toLowerCase() === label.toLowerCase());
    const direct = inSegment.filter((o) => o.classification === "Direct").length;
    return { label: label as string, direct, indirect: inSegment.length - direct, total: inSegment.length };
  });
  const active = outlets.filter((o) => o.active);
  return {
    entire: universeTables("Entire universe", outlets, segments, regions),
    selected: universeTables("Selected for Reckitt", selected, segments, regions),
    active: universeTables("Active universe", active, segments, regions),
    activeOutlets: reckittTable("Active universe - system outlets", "Direct vs Indirect", ["Direct", "Indirect"], active, (o) => o.classification, (o) => o.outletsMerged),
    recommended,
  };
}
