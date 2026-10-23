// Coverage frequency extract for the Active Outlets module: for one period (a year, quarter, month or ISO week) every outlet that bought in it, with how
// often it bought, and the summary those rows add up to (Total Coverage by channel and by region, all outlets and split Direct / Indirect). The outlet
// rows are built the way the Active Outlets extract builds them: the same outlet query (exportOutlets, one row per outlet), the same name profiles and
// tiering (lib/outletUniverse/tiering.ts: segment, channel, average sales, tier) and the same place cleaning, so a segment or a tier reads here as it does
// in that extract. On top of that: the period's purchase days and cadence, the Absolute Principal, and Direct / Indirect.
//
// Covered = bought: a purchase day from the same event feeds the Active Outlet rebuild reads (Pine ActiveOutletEvent, Leverage invoices, EABL DMS
// productive calls, Upfield DataEdge sales), not a call. Every outlet lands in ONE cadence, the best it kept up in the period (frequencyPeriod.ts).
// Absolute Principal = the principal with the largest sales at the outlet. Direct / Indirect is how that principal reaches the outlet: Primary Sales is
// Direct and Secondary Sales Indirect (an outlet that is Primary + Secondary on that principal counts as Primary, the tiering workbook's Classification2). Confectioneries are the principals in CONFECTIONERY_BRANDS.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { OUTLET_SOURCE_LABELS, buyingTenure, longPurchaseConsistency, purchaseConsistency, type OutletSource } from "./normalize";
import { exportOutlets, parseOutletFilters, type OutletFilters, type OutletListRow, type OutletScope } from "./query";
import { buildNameProfiles, classification2, cleanPlaces, isPlaceholderPlace, tierRow } from "./tiering";
import { CADENCES, cadenceFor, type Cadence, type FrequencyPeriod } from "./frequencyPeriod";

export * from "./frequencyPeriod";

/** Brand keys (normalizePrincipalKey) of the confectionery principals: all of Mars, as agreed (its pet care and food lines cannot be told apart in outlet data). */
export const CONFECTIONERY_BRANDS = ["mars"];

// ---------------------------------------------------------------------------
// Channel, region and Direct / Indirect: the rows of the summary
// ---------------------------------------------------------------------------

/** The summary's channel rows. DTR is kept because the layout has it, but no segment maps to it (retail outlets are Others). */
export const CHANNELS = ["DTR", "Wholesalers", "Minimart", "LMT", "Key Accounts", "Institutions", "Others"] as const;
export type CoverageChannel = (typeof CHANNELS)[number];

const LMT_SEGMENTS = new Set(["supermarkets", "supermarket", "large modern trade", "hyper", "hypermarket", "lmt", "modern trade"]);
const MINIMART_SEGMENTS = new Set(["minimart", "minimarts", "mini mart", "mini mart/t3 store"]);
const WHOLESALER_SEGMENTS = new Set(["wholesalers", "wholesaler", "distributor", "distributors"]);
const INSTITUTION_SEGMENTS = new Set(["institutions", "institution"]);

/** The summary channel of an outlet from its tiered segment (lib/outletUniverse/tiering.ts); an outlet served by a key account rep is a Key Account
 *  whatever its segment. Everything else, retail and horeca included, is Others. */
export function coverageChannel(segment: string, keyAccount: boolean): CoverageChannel {
  if (keyAccount) return "Key Accounts";
  const value = segment.trim().toLowerCase();
  if (WHOLESALER_SEGMENTS.has(value)) return "Wholesalers";
  if (MINIMART_SEGMENTS.has(value)) return "Minimart";
  if (LMT_SEGMENTS.has(value)) return "LMT";
  if (INSTITUTION_SEGMENTS.has(value)) return "Institutions";
  return "Others";
}

/** The summary's region rows; "Others" takes anything that cannot be placed. Mountain is Central, Nyeri and Nyahururu together. */
export const REGIONS = ["Nairobi", "Mountain", "Eastern", "Coast", "Western", "South Rift", "South Nyanza", "North Rift", "Others"] as const;

const REGION_NAMES: Record<string, (typeof REGIONS)[number]> = {
  nairobi: "Nairobi",
  mountain: "Mountain",
  central: "Mountain",
  nyeri: "Mountain",
  nyahururu: "Mountain",
  eastern: "Eastern",
  coast: "Coast",
  western: "Western",
  "south rift": "South Rift",
  "south nyanza": "South Nyanza",
  "north rift": "North Rift",
};

/** The summary region of an outlet: its region when that is one of the known ones, else its branch (location), else Others. A region that is a place
 *  rather than a region (Pine's "1Tana River", "Isiolo") or a placeholder ("Unspecified", "General") falls back to the branch the outlet is served from. */
export function coverageRegion(region: string | null | undefined, location: string | null | undefined): (typeof REGIONS)[number] {
  const byRegion = isPlaceholderPlace(region) ? undefined : REGION_NAMES[(region ?? "").trim().toLowerCase()];
  if (byRegion) return byRegion;
  const byLocation = isPlaceholderPlace(location) ? undefined : REGION_NAMES[(location ?? "").trim().toLowerCase()];
  return byLocation ?? "Others";
}

export type Classification = "Direct" | "Indirect";

/** Primary Sales is Direct and Secondary Sales Indirect; an outlet reached by both roles is Primary (the tiering workbook's Classification2). */
export function classificationOf(salesRole: string): Classification {
  return classification2(salesRole) === "Primary Sales" ? "Direct" : "Indirect";
}

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

export interface OutletEvents {
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

/** One row per outlet, the months it bought in as parallel arrays (a year of Pine is 60,000 outlets, not 380,000 outlet-month rows). */
export interface RawOutletEvents {
  outletKey: string;
  months: number[];
  alls: number[];
  confs: number[];
  others: number[];
  first: Date | string;
  last: Date | string;
}

/** Folds a per outlet and month query (outletKey, m, all, conf, other, first, last) into one row per outlet. */
function perOutlet(perMonth: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT "outletKey", ARRAY_AGG(m ORDER BY m) AS months, ARRAY_AGG("all" ORDER BY m) AS alls, ARRAY_AGG(conf ORDER BY m) AS confs,
           ARRAY_AGG(other ORDER BY m) AS others, MIN(first) AS first, MAX(last) AS last
    FROM (${perMonth}) g GROUP BY "outletKey"`;
}

/** Adds one outlet's rows from the queries, whose months are calendar months (1 to 12, as EXTRACT(MONTH) gives them); the extract works in month indexes (0 to 11). */
export function addOutletEvents(into: Map<string, OutletEvents>, source: string, r: RawOutletEvents) {
  r.months.forEach((calendarMonth, i) => addEvents(into, outletId(source, r.outletKey), { m: calendarMonth - 1, all: r.alls[i], conf: r.confs[i], other: r.others[i], first: iso(r.first), last: iso(r.last) }));
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
      ? prisma.$queryRaw<RawOutletEvents[]>(perOutlet(Prisma.sql`
          SELECT "customerId" AS "outletKey", EXTRACT(MONTH FROM date)::int AS m,
                 COUNT(DISTINCT date::date)::int AS "all",
                 (COUNT(DISTINCT date::date) FILTER (WHERE ${confSql(Prisma.sql`principal`)}))::int AS conf,
                 (COUNT(DISTINCT date::date) FILTER (WHERE NOT (${confSql(Prisma.sql`principal`)})))::int AS other,
                 MIN(date::date) AS first, MAX(date::date) AS last
          FROM "ActiveOutletEvent"
          WHERE date >= ${start} AND date < ${end} AND ${principalPredicate(Prisma.sql`principal`, filters, scope)}
            ${filters.role ? Prisma.sql`AND "salesRole" = ${filters.role}` : Prisma.empty}
          GROUP BY 1, 2`))
      : [],
    wants("EABL") && !secondaryOnly
      ? prisma.$queryRaw<RawOutletEvents[]>(perOutlet(Prisma.sql`
          SELECT ec."customerCode" AS "outletKey", EXTRACT(MONTH FROM ec."callDate")::int AS m,
                 COUNT(DISTINCT ec."callDate"::date)::int AS "all",
                 (COUNT(DISTINCT ec."callDate"::date) FILTER (WHERE ${confSql(Prisma.sql`ecm.principal`)}))::int AS conf,
                 (COUNT(DISTINCT ec."callDate"::date) FILTER (WHERE NOT (${confSql(Prisma.sql`ecm.principal`)})))::int AS other,
                 MIN(ec."callDate"::date) AS first, MAX(ec."callDate"::date) AS last
          FROM "EablCall" ec INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
          WHERE ec."isProductive" AND ec."customerCode" IS NOT NULL AND ec."callDate" >= ${start} AND ec."callDate" < ${end}
            AND ${principalPredicate(Prisma.sql`ecm.principal`, filters, scope)}
          GROUP BY 1, 2`))
      : [],
    wants("UPFIELD") && !secondaryOnly && principalAllowed("Upfield-Nairobi", filters, scope)
      ? prisma.$queryRaw<RawOutletEvents[]>(perOutlet(Prisma.sql`
          SELECT "custCode" AS "outletKey", EXTRACT(MONTH FROM "txnDate")::int AS m,
                 COUNT(DISTINCT "txnDate"::date)::int AS "all", 0 AS conf, COUNT(DISTINCT "txnDate"::date)::int AS other,
                 MIN("txnDate"::date) AS first, MAX("txnDate"::date) AS last
          FROM "UpfieldTransaction"
          WHERE type = 'sale' AND "custCode" IS NOT NULL AND btrim("custCode") <> '' AND "custCode" <> '000'
            AND UPPER(COALESCE("custName", '')) NOT LIKE '%CONNECTIVITY TEST%' AND "txnDate" >= ${start} AND "txnDate" < ${end}
          GROUP BY 1, 2`))
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

  for (const r of pine) addOutletEvents(out, "PINE", r);
  for (const r of eabl) addOutletEvents(out, "EABL", r);
  for (const r of upfield) addOutletEvents(out, "UPFIELD", r);
  for (const r of leverage) {
    const principal = `Unilever-${SALES_RETURNS_BRANCH_LABELS[r.storageLocation] ?? r.storageLocation}`;
    if (!principalAllowed(principal, filters, scope)) continue;
    addEvents(out, outletId("LEVERAGE", r.outletKey), { m: r.m - 1, all: r.all, conf: isConfectionery(principal) ? r.all : 0, other: isConfectionery(principal) ? 0 : r.all, first: iso(r.first), last: iso(r.last) });
  }
  return out;
}

/** The role each outlet-principal row sells through, by source, outlet and principal: the role of an outlet's Absolute Principal gives its Direct / Indirect. */
const roleKey = (source: string, outletKey: string, principal: string) => `${source} ${outletKey} ${principal}`;

async function loadRoles(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<{ source: string; outletKey: string; principal: string; salesRole: string }[]>(Prisma.sql`SELECT source, "outletKey", principal, "salesRole" FROM "OutletUniverse"`);
  return new Map(rows.map((r) => [roleKey(r.source, r.outletKey, r.principal), r.salesRole]));
}

/** The reps of the confectionery principals who are key account managers on the roster (work group KAMs). Their outlets are the Key Accounts. */
async function loadKeyAccountReps(): Promise<Set<string>> {
  const reps = await prisma.employeeMaster.findMany({ where: { workGroup: { contains: "kam", mode: "insensitive" } }, select: { pineName: true, sapName: true, absolutePrincipal: true } });
  const names = new Set<string>();
  for (const rep of reps) {
    if (!CONFECTIONERY_BRANDS.includes(normalizePrincipalKey(rep.absolutePrincipal))) continue;
    for (const name of [rep.pineName, rep.sapName]) if (name && name.trim()) names.add(name.trim().toLowerCase());
  }
  return names;
}

/** Whether any rep selling the outlet (the one named on the row, or any in "Principal: Rep; ...") is a key account rep. */
export function servedByKeyAccountRep(row: Pick<OutletListRow, "repName" | "repsByPrincipal">, keyReps: ReadonlySet<string>): boolean {
  if (keyReps.size === 0) return false;
  if (row.repName && keyReps.has(row.repName.trim().toLowerCase())) return true;
  return (row.repsByPrincipal ?? "").split(";").some((entry) => keyReps.has(entry.slice(entry.indexOf(":") + 1).trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// One row per outlet
// ---------------------------------------------------------------------------

export interface FrequencyOutlet {
  source: string;
  outletKey: string;
  outletName: string;
  channel: CoverageChannel;
  /** Tiered segment (the Active Outlets extract's Segment / Type) and the segment the source system gave. */
  segment: string;
  sourceSegment: string;
  tier: string;
  regionGroup: string;
  region: string;
  territory: string;
  classification: Classification;
  absolutePrincipal: string;
  principals: string;
  teamLeader: string;
  boughtConfectionery: boolean;
  boughtOther: boolean;
  /** Sales YTD over Transactions YTD, and the name's combined average the tier is read from (as in the Active Outlets extract). */
  averageSales: number | null;
  combinedAverage: number | null;
  purchaseDays: number;
  purchaseDaysConfectionery: number;
  purchaseDaysOther: number;
  /** Purchase days over the months of the period that have started. */
  purchaseDaysPerMonth: number;
  monthsBought: number;
  firstPurchase: string;
  lastPurchase: string;
  cadenceAll: Cadence;
  /** Cadence counting only purchases of non-confectionery principals; null when the outlet bought none. */
  cadenceOther: Cadence | null;
  /** Purchase days per calendar month (index 0 = January), all principals. */
  daysByMonth: number[];
  /** Buying history as of today, as the Active Outlets extract gives it. */
  periodsBought90: number;
  consistency90: string;
  periodsBought180: number;
  consistency180: string;
  buyingTenure: string;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number | null) => (value === null ? null : Math.round(value * 100) / 100);

/** The outlets that bought in the period, each with its tiering, classification and cadence. `rows` are the Active Outlets extract's outlet rows (general
 *  view); `profiles` are the name profiles built from the whole universe, so an outlet keeps its tier whatever the filters are. */
export function buildFrequencyOutlets(
  rows: OutletListRow[],
  profiles: ReturnType<typeof buildNameProfiles>,
  events: Map<string, OutletEvents>,
  period: Pick<FrequencyPeriod, "kind" | "startedMonths">,
  keyReps: ReadonlySet<string> = new Set(),
  roles: ReadonlyMap<string, string> = new Map(),
  now: Date = new Date()
): FrequencyOutlet[] {
  const monthsExpected = Math.max(1, period.startedMonths.length);
  const built: FrequencyOutlet[] = [];
  for (const row of rows) {
    const ev = events.get(outletId(row.source, row.outletKey));
    if (!ev) continue;
    const tiered = tierRow(row, profiles);
    const places = cleanPlaces(row);
    const monthsAll = new Set<number>();
    const monthsOther = new Set<number>();
    let all = 0;
    let conf = 0;
    let other = 0;
    for (const [m, d] of ev.months) {
      if (d.all > 0) monthsAll.add(m);
      if (d.other > 0) monthsOther.add(m);
      all += d.all;
      conf += d.conf;
      other += d.other;
    }
    built.push({
      source: OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source,
      outletKey: row.outletKey,
      outletName: row.outletName,
      channel: coverageChannel(tiered.segment, servedByKeyAccountRep(row, keyReps)),
      segment: tiered.segment,
      sourceSegment: row.segment,
      tier: tiered.tier,
      regionGroup: coverageRegion(row.region, row.location),
      region: places.region,
      territory: places.territory,
      classification: classificationOf((row.dominantPrincipal ? roles.get(roleKey(row.source, row.outletKey, row.dominantPrincipal)) : undefined) ?? row.salesRole),
      absolutePrincipal: row.dominantPrincipal ?? row.principals,
      principals: row.principals,
      teamLeader: (row.teamLeader ?? "").trim(),
      boughtConfectionery: conf > 0,
      boughtOther: other > 0,
      averageSales: round2(tiered.averageSales),
      combinedAverage: round2(tiered.combinedAverage),
      purchaseDays: all,
      purchaseDaysConfectionery: conf,
      purchaseDaysOther: other,
      purchaseDaysPerMonth: round1(all / monthsExpected),
      monthsBought: monthsAll.size,
      firstPurchase: ev.first ?? "",
      lastPurchase: ev.last ?? "",
      cadenceAll: cadenceFor(monthsAll, period) ?? "Once per Year",
      cadenceOther: cadenceFor(monthsOther, period),
      daysByMonth: Array.from({ length: 12 }, (_, m) => ev.months.get(m)?.all ?? 0),
      periodsBought90: row.periodsBought90,
      consistency90: purchaseConsistency(row.periodsBought90),
      periodsBought180: row.periodsBought180,
      consistency180: longPurchaseConsistency(row.periodsBought180),
      buyingTenure: buyingTenure(row.firstPurchaseDate, now).band,
    });
  }
  return built.sort((a, b) => a.source.localeCompare(b.source) || a.outletName.localeCompare(b.outletName) || a.outletKey.localeCompare(b.outletKey));
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export interface FrequencyRow {
  label: string;
  counts: Record<Cadence, number>;
  total: number;
}

export interface FrequencyTable {
  title: string;
  rowHeader: string;
  rows: FrequencyRow[];
  total: FrequencyRow;
}

const emptyCounts = (): Record<Cadence, number> => ({ "Once per Year": 0, "Once in 6 Months": 0, "Once in 3 Months": 0, "Once Per Month": 0 });

function table(title: string, rowHeader: string, labels: readonly string[], items: FrequencyOutlet[], group: (o: FrequencyOutlet) => string): FrequencyTable {
  const rows: FrequencyRow[] = labels.map((label) => ({ label, counts: emptyCounts(), total: 0 }));
  const byLabel = new Map(rows.map((r) => [r.label, r]));
  for (const o of items) {
    const row = byLabel.get(group(o));
    if (!row) continue;
    row.counts[o.cadenceAll] += 1;
    row.total += 1;
  }
  const total: FrequencyRow = { label: "Total", counts: emptyCounts(), total: 0 };
  for (const row of rows) {
    for (const c of CADENCES) total.counts[c] += row.counts[c];
    total.total += row.total;
  }
  return { title, rowHeader, rows, total };
}

export interface FrequencySummary {
  /** Every outlet by channel. */
  all: FrequencyTable;
  /** Direct (Primary) and Indirect (Secondary) outlets by channel, then by region. */
  directChannel: FrequencyTable;
  indirectChannel: FrequencyTable;
  directRegion: FrequencyTable;
  indirectRegion: FrequencyTable;
}

export function buildFrequencySummary(outlets: FrequencyOutlet[]): FrequencySummary {
  const direct = outlets.filter((o) => o.classification === "Direct");
  const indirect = outlets.filter((o) => o.classification === "Indirect");
  const byChannel = (o: FrequencyOutlet) => o.channel;
  const byRegion = (o: FrequencyOutlet) => o.regionGroup;
  return {
    all: table("Total Coverage (Including Confectioneries)", "Channel", CHANNELS, outlets, byChannel),
    directChannel: table("Total Coverage - Direct", "Channel", CHANNELS, direct, byChannel),
    indirectChannel: table("Total Coverage - Indirect", "Channel", CHANNELS, indirect, byChannel),
    directRegion: table("Total Coverage - Direct", "Region", REGIONS, direct, byRegion),
    indirectRegion: table("Total Coverage - Indirect", "Region", REGIONS, indirect, byRegion),
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

const noFilters = (): OutletFilters => parseOutletFilters(new URLSearchParams({ view: "general", status: "all" }));

/** True when none of the dashboard's narrowing filters is set, so the filtered rows and the whole-universe rows (for the name profiles) are the same rows. */
function isUnfiltered(f: OutletFilters): boolean {
  return !(f.role || f.source || f.principal || f.principalKey || f.channel || f.segment || f.region || f.territory || f.route || f.rep || f.q);
}

/** Every outlet matching the filters that bought in the period, and the summary of them. The Active/Inactive status filter is ignored: an outlet that
 *  bought in a past period counts whatever it is today. The outlet query and the name profiles are the Active Outlets extract's own (one query when
 *  nothing narrows the universe, two when something does, as in that extract). */
export async function loadFrequencyReport(period: FrequencyPeriod, filters: OutletFilters, scope: OutletScope): Promise<FrequencyReport> {
  const general: OutletFilters = { ...filters, view: "general", status: "all" };
  const unfiltered = isUnfiltered(filters);
  const [rows, universe, events, keyReps, roles] = await Promise.all([
    exportOutlets(general, scope, { withMix: true }),
    unfiltered ? Promise.resolve(null) : exportOutlets(noFilters(), scope, { withMix: false }),
    loadPurchaseDays(period, filters, scope),
    loadKeyAccountReps(),
    loadRoles(),
  ]);
  const profiles = buildNameProfiles(universe ?? rows);
  const outlets = buildFrequencyOutlets(rows, profiles, events, period, keyReps, roles);
  return { period, outlets, summary: buildFrequencySummary(outlets), generatedAt: new Date().toISOString() };
}
