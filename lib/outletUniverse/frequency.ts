// Coverage frequency extract for the Active Outlets module: for one period (a year, quarter, month or ISO week) every outlet that bought in it, with
// how often it bought, plus the summary the raw rows add up to (the "Total Coverage" tables: outlets by channel and by region against the cadence
// they were covered at). The summary is a pivot of the raw rows, so the Excel file carries it as COUNTIFS over its own data sheet.
//
// Covered = bought: a purchase day from the same event feeds the Active Outlet rebuild reads (Pine ActiveOutletEvent, Leverage invoices, EABL DMS
// productive calls, Upfield DataEdge sales), not a call. Every outlet lands in ONE cadence, the best it kept up in the period:
//   Once Per Month   bought in every month of the period that has started
//   Once in 3 Months bought in every quarter of the period
//   Once in 6 Months bought in every half-year of the period
//   Once per Year    bought at least once
// A month or a week has a single month in it, so any purchase is "Once Per Month". Confectioneries are the principals in CONFECTIONERY_BRANDS.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "./normalize";
import { baseWhere, type OutletFilters, type OutletScope } from "./query";
import { CADENCES, cadenceFor, type Cadence, type FrequencyPeriod } from "./frequencyPeriod";

export * from "./frequencyPeriod";

/** Brand keys (normalizePrincipalKey) of the confectionery principals: all of Mars, as agreed (its pet care and food lines cannot be told apart in outlet data). */
export const CONFECTIONERY_BRANDS = ["mars"];

// ---------------------------------------------------------------------------
// Channel and region groups for the summary rows
// ---------------------------------------------------------------------------

export const CHANNEL_GROUPS = ["Retail", "Wholesale", "Modern Trade", "On Trade", "Others"] as const;

export function channelGroup(channel: string | null | undefined): string {
  const value = (channel ?? "").trim().toLowerCase();
  if (value === "retail") return "Retail";
  if (value === "wholesale") return "Wholesale";
  if (value === "modern trade") return "Modern Trade";
  if (value === "on trade") return "On Trade";
  return "Others";
}

const REGION_ROWS = 8;
const regionName = (region: string | null | undefined) => (region ?? "").trim() || "Unspecified";

// ---------------------------------------------------------------------------
// Purchase days in the period
// ---------------------------------------------------------------------------

export interface MonthDays {
  /** Distinct purchase days across the outlet's principals. */
  all: number;
  /** Distinct purchase days on a confectionery principal / on any other principal. */
  conf: number;
  other: number;
}

interface OutletEvents {
  months: Map<number, MonthDays>;
  first: string | null;
  last: string | null;
}

const outletId = (source: string, outletKey: string) => `${source}\u0000${outletKey}`;

function brandSql(column: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`regexp_replace(lower(split_part(${column}, '-', 1)), '[^a-z0-9]', '', 'g')`;
}

/** The principal restrictions of the request (the session's own principals and the principal filters) as a condition on an event's principal. */
function principalPredicate(column: Prisma.Sql, filters: OutletFilters, scope: OutletScope): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (scope) parts.push(scope.principals.length > 0 ? Prisma.sql`lower(${column}) IN (${Prisma.join(scope.principals.map((name) => name.toLowerCase()))})` : Prisma.sql`FALSE`);
  if (filters.principal) parts.push(Prisma.sql`lower(${column}) = ${filters.principal.toLowerCase()}`);
  if (filters.principalKey) parts.push(Prisma.sql`${brandSql(column)} = ${normalizePrincipalKey(filters.principalKey)}`);
  return Prisma.join(parts, " AND ");
}

function principalAllowed(principal: string, filters: OutletFilters, scope: OutletScope): boolean {
  if (scope && !scope.principals.some((name) => name.toLowerCase() === principal.toLowerCase())) return false;
  if (filters.principal && filters.principal.toLowerCase() !== principal.toLowerCase()) return false;
  if (filters.principalKey && normalizePrincipalKey(filters.principalKey) !== normalizePrincipalKey(principal)) return false;
  return true;
}

const isConfectionery = (principal: string) => CONFECTIONERY_BRANDS.includes(normalizePrincipalKey(principal));

interface RawEventRow {
  outletKey: string;
  m: number;
  all: number;
  conf: number;
  other: number;
  first: Date | string;
  last: Date | string;
}

const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

function addEvents(into: Map<string, OutletEvents>, id: string, row: { m: number; all: number; conf: number; other: number; first: string; last: string }) {
  const entry = into.get(id) ?? { months: new Map<number, MonthDays>(), first: null, last: null };
  const month = entry.months.get(row.m) ?? { all: 0, conf: 0, other: 0 };
  month.all += row.all;
  month.conf += row.conf;
  month.other += row.other;
  entry.months.set(row.m, month);
  if (!entry.first || row.first < entry.first) entry.first = row.first;
  if (!entry.last || row.last > entry.last) entry.last = row.last;
  into.set(id, entry);
}

/** Per outlet and month: the days it bought in the period, by source. Only the purchase feeds the Active Outlet rebuild reads. */
async function loadPurchaseDays(period: FrequencyPeriod, filters: OutletFilters, scope: OutletScope): Promise<Map<string, OutletEvents>> {
  const out = new Map<string, OutletEvents>();
  const { start, end } = period;
  const wants = (source: OutletSource) => !filters.source || filters.source === source;
  // Only Pine records the role of a sale; the other three systems are Primary.
  const secondaryOnly = filters.role === "Secondary Sales";
  const confSql = (column: Prisma.Sql) => Prisma.sql`${brandSql(column)} IN (${Prisma.join(CONFECTIONERY_BRANDS)})`;

  const [pine, eabl, upfield, leverage] = await Promise.all([
    wants("PINE")
      ? prisma.$queryRaw<RawEventRow[]>(Prisma.sql`
          SELECT "customerId" AS "outletKey", EXTRACT(MONTH FROM date)::int AS m,
                 COUNT(DISTINCT date::date)::int AS "all",
                 (COUNT(DISTINCT date::date) FILTER (WHERE ${confSql(Prisma.sql`principal`)}))::int AS conf,
                 (COUNT(DISTINCT date::date) FILTER (WHERE NOT (${confSql(Prisma.sql`principal`)})))::int AS other,
                 MIN(date::date) AS first, MAX(date::date) AS last
          FROM "ActiveOutletEvent"
          WHERE date >= ${start} AND date < ${end} AND ${principalPredicate(Prisma.sql`principal`, filters, scope)}
            ${filters.role ? Prisma.sql`AND "salesRole" = ${filters.role}` : Prisma.empty}
          GROUP BY 1, 2`)
      : [],
    wants("EABL") && !secondaryOnly
      ? prisma.$queryRaw<RawEventRow[]>(Prisma.sql`
          SELECT ec."customerCode" AS "outletKey", EXTRACT(MONTH FROM ec."callDate")::int AS m,
                 COUNT(DISTINCT ec."callDate"::date)::int AS "all",
                 (COUNT(DISTINCT ec."callDate"::date) FILTER (WHERE ${confSql(Prisma.sql`ecm.principal`)}))::int AS conf,
                 (COUNT(DISTINCT ec."callDate"::date) FILTER (WHERE NOT (${confSql(Prisma.sql`ecm.principal`)})))::int AS other,
                 MIN(ec."callDate"::date) AS first, MAX(ec."callDate"::date) AS last
          FROM "EablCall" ec INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
          WHERE ec."isProductive" AND ec."customerCode" IS NOT NULL AND ec."callDate" >= ${start} AND ec."callDate" < ${end}
            AND ${principalPredicate(Prisma.sql`ecm.principal`, filters, scope)}
          GROUP BY 1, 2`)
      : [],
    wants("UPFIELD") && !secondaryOnly && principalAllowed("Upfield-Nairobi", filters, scope)
      ? prisma.$queryRaw<RawEventRow[]>(Prisma.sql`
          SELECT "custCode" AS "outletKey", EXTRACT(MONTH FROM "txnDate")::int AS m,
                 COUNT(DISTINCT "txnDate"::date)::int AS "all", 0 AS conf, COUNT(DISTINCT "txnDate"::date)::int AS other,
                 MIN("txnDate"::date) AS first, MAX("txnDate"::date) AS last
          FROM "UpfieldTransaction"
          WHERE type = 'sale' AND "custCode" IS NOT NULL AND btrim("custCode") <> '' AND "custCode" <> '000'
            AND UPPER(COALESCE("custName", '')) NOT LIKE '%CONNECTIVITY TEST%' AND "txnDate" >= ${start} AND "txnDate" < ${end}
          GROUP BY 1, 2`)
      : [],
    wants("LEVERAGE") && !secondaryOnly
      ? prisma.$queryRaw<(RawEventRow & { storageLocation: string })[]>(Prisma.sql`
          SELECT "customerCode" AS "outletKey", "storageLocation", EXTRACT(MONTH FROM "deliveryDate")::int AS m,
                 COUNT(DISTINCT "deliveryDate"::date)::int AS "all", 0 AS conf, COUNT(DISTINCT "deliveryDate"::date)::int AS other,
                 MIN("deliveryDate"::date) AS first, MAX("deliveryDate"::date) AS last
          FROM "SalesReturnLine"
          WHERE "documentType" IN ('01', '06') AND "deliveryDate" >= ${start} AND "deliveryDate" < ${end}
          GROUP BY 1, 2, 3`)
      : [],
  ]);

  for (const r of pine) addEvents(out, outletId("PINE", r.outletKey), { m: r.m, all: r.all, conf: r.conf, other: r.other, first: iso(r.first), last: iso(r.last) });
  for (const r of eabl) addEvents(out, outletId("EABL", r.outletKey), { m: r.m, all: r.all, conf: r.conf, other: r.other, first: iso(r.first), last: iso(r.last) });
  for (const r of upfield) addEvents(out, outletId("UPFIELD", r.outletKey), { m: r.m, all: r.all, conf: r.conf, other: r.other, first: iso(r.first), last: iso(r.last) });
  for (const r of leverage) {
    const principal = `Unilever-${SALES_RETURNS_BRANCH_LABELS[r.storageLocation] ?? r.storageLocation}`;
    if (!principalAllowed(principal, filters, scope)) continue;
    addEvents(out, outletId("LEVERAGE", r.outletKey), { m: r.m, all: r.all, conf: isConfectionery(principal) ? r.all : 0, other: isConfectionery(principal) ? 0 : r.all, first: iso(r.first), last: iso(r.last) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// One row per outlet
// ---------------------------------------------------------------------------

export interface FrequencyOutlet {
  source: OutletSource;
  outletKey: string;
  outletName: string;
  channelGroup: string;
  channel: string;
  segment: string;
  rawChannel: string;
  rawSegment: string;
  regionGroup: string;
  region: string;
  territory: string;
  location: string;
  route: string;
  rep: string;
  teamLeader: string;
  principals: string;
  boughtConfectionery: boolean;
  boughtOther: boolean;
  purchaseDays: number;
  purchaseDaysConfectionery: number;
  purchaseDaysOther: number;
  monthsBought: number;
  firstPurchase: string;
  lastPurchase: string;
  cadenceAll: Cadence;
  /** Cadence counting only purchases of non-confectionery principals; null when the outlet bought none. */
  cadenceOther: Cadence | null;
  /** Purchase days per calendar month (index 0 = January), all principals. */
  daysByMonth: number[];
}

interface UniverseRow {
  source: OutletSource;
  outletKey: string;
  principal: string;
  outletName: string;
  channel: string;
  segment: string;
  rawChannel: string | null;
  rawSegment: string | null;
  location: string;
  region: string;
  territory: string;
  route: string | null;
  repName: string | null;
  teamLeader: string | null;
  sales: number;
}

export function buildFrequencyOutlets(universe: UniverseRow[], events: Map<string, OutletEvents>, period: Pick<FrequencyPeriod, "kind" | "startedMonths">): FrequencyOutlet[] {
  const byOutlet = new Map<string, UniverseRow[]>();
  for (const row of universe) {
    const id = outletId(row.source, row.outletKey);
    if (events.has(id)) (byOutlet.get(id) ?? byOutlet.set(id, []).get(id)!).push(row);
  }

  const built = [...byOutlet.entries()].map(([id, rows]) => {
    const lead = [...rows].sort((a, b) => b.sales - a.sales || a.principal.localeCompare(b.principal))[0];
    const ev = events.get(id)!;
    const monthsAll = new Set([...ev.months.entries()].filter(([, d]) => d.all > 0).map(([m]) => m));
    const monthsOther = new Set([...ev.months.entries()].filter(([, d]) => d.other > 0).map(([m]) => m));
    const sum = (pick: (d: MonthDays) => number) => [...ev.months.values()].reduce((s, d) => s + pick(d), 0);
    const daysByMonth = Array.from({ length: 12 }, (_, m) => ev.months.get(m)?.all ?? 0);
    return {
      source: lead.source,
      outletKey: lead.outletKey,
      outletName: lead.outletName,
      channelGroup: channelGroup(lead.channel),
      channel: lead.channel,
      segment: lead.segment,
      rawChannel: lead.rawChannel ?? "",
      rawSegment: lead.rawSegment ?? "",
      regionGroup: "",
      region: regionName(lead.region),
      territory: lead.territory,
      location: lead.location,
      route: lead.route ?? "",
      rep: (lead.repName ?? "").trim(),
      teamLeader: (lead.teamLeader ?? "").trim(),
      principals: [...new Set(rows.map((r) => r.principal))].sort().join("; "),
      boughtConfectionery: sum((d) => d.conf) > 0,
      boughtOther: sum((d) => d.other) > 0,
      purchaseDays: sum((d) => d.all),
      purchaseDaysConfectionery: sum((d) => d.conf),
      purchaseDaysOther: sum((d) => d.other),
      monthsBought: monthsAll.size,
      firstPurchase: ev.first ?? "",
      lastPurchase: ev.last ?? "",
      cadenceAll: cadenceFor(monthsAll, period) ?? "Once per Year",
      cadenceOther: cadenceFor(monthsOther, period),
      daysByMonth,
    } satisfies FrequencyOutlet;
  });

  // The region rows of the summary: the biggest regions by covered outlets, everything else as "Others".
  const sizes = new Map<string, number>();
  for (const o of built) sizes.set(o.region, (sizes.get(o.region) ?? 0) + 1);
  const top = new Set([...sizes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, REGION_ROWS).map(([name]) => name));
  for (const o of built) o.regionGroup = top.has(o.region) ? o.region : "Others";

  return built.sort((a, b) => a.source.localeCompare(b.source) || a.outletName.localeCompare(b.outletName) || a.outletKey.localeCompare(b.outletKey));
}

// ---------------------------------------------------------------------------
// The summary (the example's three tables)
// ---------------------------------------------------------------------------

export interface FrequencyRow {
  label: string;
  counts: Record<Cadence, number>;
  total: number;
  /** Outlets that bought a confectionery principal (table one only). */
  confectionery?: number;
}

export interface FrequencyTable {
  title: string;
  rowHeader: string;
  rows: FrequencyRow[];
  total: FrequencyRow;
}

const emptyCounts = (): Record<Cadence, number> => ({ "Once per Year": 0, "Once in 6 Months": 0, "Once in 3 Months": 0, "Once Per Month": 0 });

function table(title: string, rowHeader: string, labels: string[], items: FrequencyOutlet[], group: (o: FrequencyOutlet) => string, cadence: (o: FrequencyOutlet) => Cadence | null, withConfectionery = false): FrequencyTable {
  const rows: FrequencyRow[] = labels.map((label) => ({ label, counts: emptyCounts(), total: 0, ...(withConfectionery ? { confectionery: 0 } : {}) }));
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  for (const o of items) {
    const row = byLabel.get(group(o));
    if (!row) continue;
    if (withConfectionery && o.boughtConfectionery) row.confectionery = (row.confectionery ?? 0) + 1;
    const c = cadence(o);
    if (!c) continue;
    row.counts[c] += 1;
    row.total += 1;
  }
  const total: FrequencyRow = { label: "Total", counts: emptyCounts(), total: 0, ...(withConfectionery ? { confectionery: 0 } : {}) };
  for (const row of rows) {
    for (const c of CADENCES) total.counts[c] += row.counts[c];
    total.total += row.total;
    if (withConfectionery) total.confectionery = (total.confectionery ?? 0) + (row.confectionery ?? 0);
  }
  return { title, rowHeader, rows, total };
}

export interface FrequencySummary {
  including: FrequencyTable;
  excluding: FrequencyTable;
  byRegion: FrequencyTable;
}

export function buildFrequencySummary(outlets: FrequencyOutlet[]): FrequencySummary {
  const nonConf = outlets.filter((o) => o.cadenceOther !== null);
  const regionSizes = new Map<string, number>();
  for (const o of nonConf) regionSizes.set(o.regionGroup, (regionSizes.get(o.regionGroup) ?? 0) + 1);
  const regionLabels = [...regionSizes.entries()]
    .sort((a, b) => Number(a[0] === "Others") - Number(b[0] === "Others") || b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return {
    including: table("Total Coverage (Including Confectioneries)", "Channel", [...CHANNEL_GROUPS], outlets, (o) => o.channelGroup, (o) => o.cadenceAll, true),
    excluding: table("Total Coverage (Excluding Confectioneries)", "Channel", [...CHANNEL_GROUPS], nonConf, (o) => o.channelGroup, (o) => o.cadenceOther),
    byRegion: table("Total Coverage by Region (Excluding Confectioneries)", "Region", regionLabels, nonConf, (o) => o.regionGroup, (o) => o.cadenceOther),
  };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface FrequencyReport {
  period: FrequencyPeriod;
  outlets: FrequencyOutlet[];
  summary: FrequencySummary;
  generatedAt: string;
}

/** Every outlet matching the filters that bought in the period, and the summary of them. The Active/Inactive status filter is ignored: an outlet
 *  that bought in a past period counts whatever it is today. */
export async function loadFrequencyReport(period: FrequencyPeriod, filters: OutletFilters, scope: OutletScope): Promise<FrequencyReport> {
  const [universe, events] = await Promise.all([
    prisma.$queryRaw<UniverseRow[]>(Prisma.sql`
      SELECT source, "outletKey", principal, "outletName", channel, segment, "rawChannel", "rawSegment", location, region, territory, route, "repName", "teamLeader", sales::double precision AS sales
      FROM "OutletUniverse" WHERE ${baseWhere(filters, scope)}`),
    loadPurchaseDays(period, filters, scope),
  ]);
  const outlets = buildFrequencyOutlets(universe, events, period);
  return { period, outlets, summary: buildFrequencySummary(outlets), generatedAt: new Date().toISOString() };
}

export const frequencySourceLabel = (source: OutletSource) => OUTLET_SOURCE_LABELS[source] ?? source;
