// Cost Centre resolution, purchase-event collapsing, Sales Role classification
// (all three duplicated from scripts/db-bridge/active-outlets/transform.ts —
// same "duplicate, don't cross-import between bridge subtrees" precedent that
// file itself documents), plus the JP Adherence-specific builders: rep-outlet
// visit frequency, the geo-sweep route/home-day algorithm, Journey Plan
// generation, planned-vs-actual JP Adherence matching, and Monthly Split.
// Ported from the user-supplied JP_Adherence_Report_Extractor_Summary.py
// script's build_rep_outlet_visits/resolve_rep_costcentre_groups/
// _geo_sweep_home_days/min_outlets_target/build_journey_plan/
// build_jp_adherence/monthly_split — see the session's implementation plan
// for the line-number mapping back to that script.
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { FactLineRow, NoSaleVisitRow, OutletRow, ProductRow, UserRow } from "./query";

const MONTH_ABBR = CANONICAL_MONTHS.map((m) => m.slice(0, 3));

export interface PrincipalRow {
  key: string;
  principal: string;
  mainPrincipal: string;
  location: string;
  locationCode: string;
  status: string;
  teamLeader: string;
}

// ---------------------------------------------------------------------------
// Cost Centre resolution — verbatim duplicate of active-outlets/transform.ts.
// ---------------------------------------------------------------------------

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

const NAIROBI_FIXUPS: [string, string][] = [
  ["EABL-Nairobi", "EABL-Nyahururu"],
  ["Premier-Machakos", "Premier-Nairobi"],
  ["Suntory-Machakos", "Suntory-Nairobi"],
  ["Suntory-Nyahururu", "Suntory-Nairobi"],
];

function resolveBrandFromSku(skuUpper: string): string {
  const match = PRINCIPAL_MAP.find(([, prefix]) => skuUpper.startsWith(prefix));
  return match ? match[0] : "";
}

function applyFixups(key: string): string {
  for (const [from, to] of NAIROBI_FIXUPS) {
    if (key === from) return to;
  }
  return key;
}

export function resolveCostCentre(sapCode: string, principals: PrincipalRow[]): PrincipalRow | null {
  const activeByKey = new Map(principals.filter((p) => p.status === "Active").map((p) => [p.principal, p]));
  const brand = resolveBrandFromSku(sapCode.trim().toUpperCase());
  if (!brand) return null;
  const cleanedBrand = brand.trim().replace(/\.$/, "");
  const fixedKey = applyFixups(`${cleanedBrand}-Nairobi`);
  return activeByKey.get(fixedKey) ?? null;
}

// ---------------------------------------------------------------------------
// Sales Role — verbatim duplicate of active-outlets/transform.ts's precise
// rule (not the Coverage bridge's simplified rule — see project memory on
// why the two intentionally differ).
// ---------------------------------------------------------------------------

const PRIMARY_GROUPS = new Set(["DSR", "KAMS", "TDR", "ADMIN"]);
const SECONDARY_DSR_CODES = new Set(["1172", "1032"]);
const MARS_COST_CENTRE = "mars";

export function classifySalesRole(userGroup: string, userId: string, costCentre: string): "Primary Sales" | "Secondary Sales" {
  const group = userGroup.trim().toUpperCase();
  const isPrimaryGroup = PRIMARY_GROUPS.has(group);
  const excludedTdrMars = group === "TDR" && costCentre.trim().toLowerCase().startsWith(MARS_COST_CENTRE);
  const excludedDsrCode = group === "DSR" && SECONDARY_DSR_CODES.has(userId.trim());
  return isPrimaryGroup && !excludedTdrMars && !excludedDsrCode ? "Primary Sales" : "Secondary Sales";
}

// ---------------------------------------------------------------------------
// Purchase events — verbatim duplicate of active-outlets/transform.ts.
// ---------------------------------------------------------------------------

export interface PurchaseEvent {
  eventKey: string;
  purchaseDate: Date;
  purchaseTime: Date;
  monthStart: string;
  year: string;
  month: string;
  monthIndex: number;
  customerId: string;
  userId: string;
  costCentre: string | null;
  salesRole: "Primary Sales" | "Secondary Sales";
  revenue: number;
  qty: number;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface CollapseResult {
  events: PurchaseEvent[];
  unmatchedSkuCount: number;
}

export function collapseToPurchaseEvents(
  lines: FactLineRow[],
  outlets: OutletRow[],
  users: UserRow[],
  products: ProductRow[],
  principals: PrincipalRow[]
): CollapseResult {
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const skuByItemId = new Map(products.map((p) => [p.id, p.sapCode]));

  interface LineEvent {
    key: string;
    date: Date;
    time: Date;
    customerId: string;
    userId: string;
    costCentre: string | null;
    revenue: number;
    qty: number;
  }
  const lineEvents: LineEvent[] = [];
  let unmatchedSkuCount = 0;

  for (const line of lines) {
    const outlet = outletById.get(line.customerId);
    const user = userById.get(line.userId);
    if (!outlet || !user) continue;
    if (!(line.qty > 0 && line.unitPrice > 0)) continue;

    const sapCode = skuByItemId.get(line.itemId);
    const costCentreRow = sapCode ? resolveCostCentre(sapCode, principals) : null;
    if (!costCentreRow) unmatchedSkuCount++;

    lineEvents.push({
      key: `${line.docId}|${line.isOrder ? 1 : 0}|${costCentreRow ? costCentreRow.principal : "UNMAPPED"}`,
      date: new Date(Date.UTC(line.purchaseTime.getUTCFullYear(), line.purchaseTime.getUTCMonth(), line.purchaseTime.getUTCDate())),
      time: line.purchaseTime,
      customerId: line.customerId,
      userId: line.userId,
      costCentre: costCentreRow ? costCentreRow.principal : null,
      revenue: Math.round(line.qty * line.unitPrice * 100) / 100,
      qty: line.qty,
    });
  }

  const byEvent = new Map<string, LineEvent[]>();
  for (const le of lineEvents) {
    if (!byEvent.has(le.key)) byEvent.set(le.key, []);
    byEvent.get(le.key)!.push(le);
  }

  const events: PurchaseEvent[] = [];
  for (const [eventKey, group] of byEvent) {
    const first = group[0];
    const earliestTime = group.reduce((min, g) => (g.time < min ? g.time : min), first.time);
    const user = userById.get(first.userId)!;
    const salesRole = classifySalesRole(user.userGroup, user.id, first.costCentre ?? "");
    events.push({
      eventKey,
      purchaseDate: first.date,
      purchaseTime: earliestTime,
      monthStart: monthKey(first.date),
      year: String(first.date.getUTCFullYear()),
      month: CANONICAL_MONTHS[first.date.getUTCMonth()],
      monthIndex: first.date.getUTCMonth(),
      customerId: first.customerId,
      userId: first.userId,
      costCentre: first.costCentre,
      salesRole,
      revenue: group.reduce((s, g) => s + g.revenue, 0),
      qty: group.reduce((s, g) => s + g.qty, 0),
    });
  }

  return { events, unmatchedSkuCount };
}

// ---------------------------------------------------------------------------
// Rep-outlet visit frequency (build_rep_outlet_visits).
// ---------------------------------------------------------------------------

export interface RepOutletVisit {
  userId: string;
  employee: string;
  userGroup: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  costCentre: string; // resolved principal, e.g. "Mars-Nairobi" — always the real per-line value
  customerId: string;
  customerName: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  visitDays: number; // distinct calendar dates this rep transacted with this outlet in the window
  visitsPerWeek: number; // round(visitDays / weeksInWindow), clamped 1-5
}

/** One row per (rep, Cost Centre, outlet) with observed visit frequency over
 *  [startDate, endDate]. Excludes null-Cost-Centre events — route generation
 *  is inherently per-Cost-Centre, same exclusion buildActiveOutlets applies. */
export function buildRepOutletVisits(events: PurchaseEvent[], outlets: OutletRow[], users: UserRow[], startDate: Date, endDate: Date): RepOutletVisit[] {
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const daysTotal = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  const weeks = Math.max(daysTotal / 7, 1);

  interface Agg {
    event: PurchaseEvent;
    dates: Set<string>;
  }
  const byKey = new Map<string, Agg>();
  for (const e of events) {
    if (e.costCentre === null) continue;
    const key = `${e.userId}|${e.costCentre}|${e.customerId}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = { event: e, dates: new Set() };
      byKey.set(key, agg);
    }
    agg.dates.add(e.purchaseDate.toISOString().slice(0, 10));
  }

  const rows: RepOutletVisit[] = [];
  for (const { event: e, dates } of byKey.values()) {
    const outlet = outletById.get(e.customerId);
    const user = userById.get(e.userId);
    const visitsPerWeek = Math.min(5, Math.max(1, Math.round(dates.size / weeks)));
    rows.push({
      userId: e.userId,
      employee: user?.employee ?? "Unknown",
      userGroup: user?.userGroup ?? "Unassigned",
      salesRole: e.salesRole,
      costCentre: e.costCentre!,
      customerId: e.customerId,
      customerName: outlet?.name ?? "Unknown Outlet",
      territory: outlet?.territory ?? "Unassigned",
      latitude: outlet?.latitude ?? null,
      longitude: outlet?.longitude ?? null,
      visitDays: dates.size,
      visitsPerWeek,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Cost Centre grouping for routing (resolve_rep_costcentre_groups).
// ---------------------------------------------------------------------------

export interface RepOutletVisitGrouped extends RepOutletVisit {
  costCentreGroup: string; // "Key Accounts" for reps trading under >1 Cost Centre, else costCentre
}

/** Reps who transact under more than one Cost Centre get all their outlets
 *  pooled under a synthetic "Key Accounts" group for routing purposes only —
 *  costCentreGroup is never persisted as a page-filterable Cost Centre value,
 *  only costCentre/principalCostCentre is (see JourneyPlanRow). */
export function resolveRepCostCentreGroups(visits: RepOutletVisit[]): RepOutletVisitGrouped[] {
  const ccByUser = new Map<string, Set<string>>();
  for (const v of visits) {
    if (!ccByUser.has(v.userId)) ccByUser.set(v.userId, new Set());
    ccByUser.get(v.userId)!.add(v.costCentre);
  }
  const multiCcUsers = new Set(Array.from(ccByUser.entries()).filter(([, ccs]) => ccs.size > 1).map(([uid]) => uid));
  return visits.map((v) => ({ ...v, costCentreGroup: multiCcUsers.has(v.userId) ? "Key Accounts" : v.costCentre }));
}

// ---------------------------------------------------------------------------
// Geo-sweep route/home-day algorithm (_geo_sweep_home_days). A cheap angular
// sweep around a centroid, NOT a TSP/distance-based clustering solve.
// ---------------------------------------------------------------------------

export interface GeoSweepInput {
  customerId: string;
  latitude: number | null;
  longitude: number | null;
}

export interface GeoSweepFields {
  routeSeq: number; // 0-based position in the angular sweep order
  homeDayIdx: number; // 0=Mon..4=Fri — which weekday-slot this outlet falls in
}

/** lat/long both non-null AND non-zero counts as "has geo" — (0,0) is treated
 *  as missing/junk data, matching the Python reference exactly (an easy
 *  regression if this were a naive `!= null` check instead). */
function hasGeo(o: GeoSweepInput): boolean {
  return o.latitude !== null && o.longitude !== null && o.latitude !== 0 && o.longitude !== 0;
}

export function geoSweepHomeDays<T extends GeoSweepInput>(outlets: T[]): (T & GeoSweepFields)[] {
  const geoOutlets = outlets.filter(hasGeo);
  const noGeoOutlets = outlets.filter((o) => !hasGeo(o));

  let order: T[] = [];
  if (geoOutlets.length > 0) {
    const clat = geoOutlets.reduce((s, o) => s + (o.latitude as number), 0) / geoOutlets.length;
    const clong = geoOutlets.reduce((s, o) => s + (o.longitude as number), 0) / geoOutlets.length;
    // atan2(latDiff, longDiff) — y=lat, x=long — matching the reference exactly;
    // swapping this would silently rotate every rep's route.
    order = [...geoOutlets].sort(
      (a, b) => Math.atan2((a.latitude as number) - clat, (a.longitude as number) - clong) - Math.atan2((b.latitude as number) - clat, (b.longitude as number) - clong)
    );
  }
  order = [...order, ...noGeoOutlets]; // no-geo outlets appended in original order, not angle-sorted

  const n = order.length;
  return order.map((o, pos) => ({
    ...o,
    routeSeq: pos,
    homeDayIdx: n > 0 ? Math.min(Math.floor((pos * 5) / n), 4) : 0,
  }));
}

// ---------------------------------------------------------------------------
// Minimum outlets/day target (min_outlets_target / MIN_OUTLETS_PER_DAY).
// ---------------------------------------------------------------------------

// Keyed on the BARE brand (lowercased), matched via startsWith against the
// location-suffixed principal string ("mars" matches "Mars-Nairobi") — same
// startsWith discipline classifySalesRole's Mars check already uses, since
// this repo's Cost Centre values are always location-suffixed, unlike the
// Python reference's bare-brand Converter.xlsx values.
const MIN_OUTLETS_PER_DAY: { brand: string; salesRole: string | null; target: number }[] = [
  { brand: "mars", salesRole: "Secondary Sales", target: 40 },
  { brand: "mars", salesRole: "Primary Sales", target: 15 },
  { brand: "bic", salesRole: null, target: 20 },
  { brand: "weetabix", salesRole: null, target: 30 },
  { brand: "suntory", salesRole: null, target: 40 },
];
const DEFAULT_MIN_OUTLETS_PER_DAY = 15;

/** costCentre is the rep's costCentreGroup, which for multi-Cost-Centre
 *  ("Key Accounts") reps never matches any brand prefix and correctly falls
 *  through to the default — same behavior as the Python reference. */
export function minOutletsTarget(costCentre: string, salesRole: string | null): number {
  const cc = costCentre.trim().toLowerCase();
  const specific = MIN_OUTLETS_PER_DAY.find((r) => cc.startsWith(r.brand) && r.salesRole === salesRole);
  if (specific) return specific.target;
  const fallback = MIN_OUTLETS_PER_DAY.find((r) => cc.startsWith(r.brand) && r.salesRole === null);
  if (fallback) return fallback.target;
  return DEFAULT_MIN_OUTLETS_PER_DAY;
}

// ---------------------------------------------------------------------------
// Journey Plan generation (build_journey_plan).
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const FREQ_DAY_OFFSETS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 2, 3],
  5: [0, 1, 2, 3, 4],
};

function monthBoundsList(start: Date, end: Date): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    months.push({ year: y, month: m });
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return months;
}

/** All weekday (Mon-Fri) dates in the given month, clipped to [start, end]
 *  inclusive, bucketed by day-of-week index (0=Mon..4=Fri), each bucket's
 *  array position implying the "occurrence within month" (1st Monday, 2nd
 *  Monday, ...). */
function weekdayDatesInMonthRanged(year: number, month: number, start: Date, end: Date): Date[][] {
  const buckets: Date[][] = [[], [], [], [], []];
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(Date.UTC(year, month, day));
    if (d < start || d > end) continue;
    const jsDay = d.getUTCDay(); // 0=Sun..6=Sat
    if (jsDay === 0 || jsDay === 6) continue;
    buckets[jsDay - 1].push(d);
  }
  return buckets;
}

export interface JourneyPlanRow {
  costCentreGroup: string;
  principalCostCentre: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  userGroup: string;
  employeeCode: string;
  employeeName: string;
  monthLabel: string; // "Jul-2026"
  day: string; // "Monday".."Friday"
  date: Date;
  weekOfMonth: number;
  dayIndex: number; // 0=Mon..4=Fri
  routeSeq: number;
  customerId: string;
  customerName: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  visitsPerWeek: number;
  minOutletsTarget: number;
  dayOutletCount: number;
  status: "OK" | "BELOW TARGET";
}

export function buildJourneyPlan(visits: RepOutletVisitGrouped[], startDate: Date, endDate: Date): JourneyPlanRow[] {
  const groups = new Map<string, RepOutletVisitGrouped[]>();
  for (const v of visits) {
    const key = `${v.costCentreGroup}|${v.userId}|${v.salesRole}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }

  const months = monthBoundsList(startDate, endDate);

  interface PlannedLine {
    costCentreGroup: string;
    principalCostCentre: string;
    salesRole: "Primary Sales" | "Secondary Sales";
    userGroup: string;
    employeeCode: string;
    employeeName: string;
    monthLabel: string;
    day: string;
    date: Date;
    weekOfMonth: number;
    dayIndex: number;
    routeSeq: number;
    customerId: string;
    customerName: string;
    territory: string;
    latitude: number | null;
    longitude: number | null;
    visitsPerWeek: number;
    minOutletsTarget: number;
  }
  const rows: PlannedLine[] = [];

  for (const groupVisits of groups.values()) {
    const first = groupVisits[0];
    const swept = geoSweepHomeDays(groupVisits);
    const target = minOutletsTarget(first.costCentreGroup, first.salesRole);

    // Precompute the full calendar-date list for every weekday slot across the
    // whole window ONCE per rep — not once per outlet — since it's identical
    // for every outlet this rep covers (the single biggest cost cut the
    // Python reference itself calls out for this step).
    const datesByDayIdx: { date: Date; occ: number; monthLabel: string }[][] = [[], [], [], [], []];
    for (const { year, month } of months) {
      const buckets = weekdayDatesInMonthRanged(year, month, startDate, endDate);
      const monthLabel = `${MONTH_ABBR[month]}-${year}`;
      for (let di = 0; di < 5; di++) {
        buckets[di].forEach((d, i) => datesByDayIdx[di].push({ date: d, occ: i + 1, monthLabel }));
      }
    }

    for (const outlet of swept) {
      const offsets = FREQ_DAY_OFFSETS[outlet.visitsPerWeek] ?? [0];
      const dayIndices = Array.from(new Set(offsets.map((o) => (outlet.homeDayIdx + o) % 5))).sort((a, b) => a - b);
      for (const di of dayIndices) {
        for (const { date, occ, monthLabel } of datesByDayIdx[di]) {
          rows.push({
            costCentreGroup: outlet.costCentreGroup,
            principalCostCentre: outlet.costCentre,
            salesRole: outlet.salesRole,
            userGroup: outlet.userGroup,
            employeeCode: outlet.userId,
            employeeName: outlet.employee,
            monthLabel,
            day: DAY_NAMES[di],
            date,
            weekOfMonth: occ,
            dayIndex: di,
            routeSeq: outlet.routeSeq,
            customerId: outlet.customerId,
            customerName: outlet.customerName,
            territory: outlet.territory,
            latitude: outlet.latitude,
            longitude: outlet.longitude,
            visitsPerWeek: outlet.visitsPerWeek,
            minOutletsTarget: target,
          });
        }
      }
    }
  }

  // An outlet can only be planned once per rep per date.
  const seen = new Set<string>();
  const deduped: PlannedLine[] = [];
  for (const r of rows) {
    const key = `${r.employeeCode}|${r.customerId}|${r.date.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  const dayCounts = new Map<string, Set<string>>();
  for (const r of deduped) {
    const key = `${r.costCentreGroup}|${r.salesRole}|${r.employeeCode}|${r.date.toISOString()}`;
    if (!dayCounts.has(key)) dayCounts.set(key, new Set());
    dayCounts.get(key)!.add(r.customerId);
  }

  return deduped
    .map((r): JourneyPlanRow => {
      const key = `${r.costCentreGroup}|${r.salesRole}|${r.employeeCode}|${r.date.toISOString()}`;
      const dayOutletCount = dayCounts.get(key)?.size ?? 0;
      return { ...r, dayOutletCount, status: dayOutletCount >= r.minOutletsTarget ? "OK" : "BELOW TARGET" };
    })
    .sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        a.costCentreGroup.localeCompare(b.costCentreGroup) ||
        a.salesRole.localeCompare(b.salesRole) ||
        a.employeeName.localeCompare(b.employeeName) ||
        a.routeSeq - b.routeSeq
    );
}

// ---------------------------------------------------------------------------
// Actual visit aggregation (the "actual" side of build_jp_adherence) — sale/
// order events + no-sale visits, collapsed to one row per (date, userId,
// customerId) BEFORE matching against the plan, so multiple SKU lines on the
// same day/outlet never double-count.
// ---------------------------------------------------------------------------

export interface ActualVisit {
  date: string; // "YYYY-MM-DD"
  userId: string;
  employee: string;
  userGroup: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  costCentre: string; // real principal seen that day, "" if only a no-sale visit with no inferrable Cost Centre
  customerId: string;
  customerName: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  revenue: number;
  qty: number;
  productive: boolean;
  visitType: string; // "Sale" | "No Sale"
}

export function aggregateActualVisits(events: PurchaseEvent[], noSaleVisits: NoSaleVisitRow[], outlets: OutletRow[], users: UserRow[]): ActualVisit[] {
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));

  interface Agg {
    date: string;
    userId: string;
    customerId: string;
    revenue: number;
    qty: number;
    productive: boolean;
    visitTypes: Set<string>;
    costCentre: string;
  }
  const byKey = new Map<string, Agg>();
  function keyFor(date: string, userId: string, customerId: string) {
    return `${date}|${userId}|${customerId}`;
  }

  for (const e of events) {
    const date = e.purchaseDate.toISOString().slice(0, 10);
    const k = keyFor(date, e.userId, e.customerId);
    let agg = byKey.get(k);
    if (!agg) {
      agg = { date, userId: e.userId, customerId: e.customerId, revenue: 0, qty: 0, productive: false, visitTypes: new Set(), costCentre: "" };
      byKey.set(k, agg);
    }
    agg.revenue += e.revenue;
    agg.qty += e.qty;
    agg.productive = true; // every PurchaseEvent is qty>0 && unitPrice>0 by construction
    agg.visitTypes.add("Sale");
    if (e.costCentre) agg.costCentre = e.costCentre;
  }

  for (const v of noSaleVisits) {
    const date = new Date(Date.UTC(v.visitTime.getUTCFullYear(), v.visitTime.getUTCMonth(), v.visitTime.getUTCDate())).toISOString().slice(0, 10);
    const k = keyFor(date, v.userId, v.customerId);
    if (!byKey.has(k)) {
      byKey.set(k, { date, userId: v.userId, customerId: v.customerId, revenue: 0, qty: 0, productive: false, visitTypes: new Set(["No Sale"]), costCentre: "" });
    }
    // A sale/order event already existing for this key already makes the visit
    // productive & counted — a no-sale log entry for the same rep+outlet+day
    // doesn't downgrade it.
  }

  const rows: ActualVisit[] = [];
  for (const agg of byKey.values()) {
    const outlet = outletById.get(agg.customerId);
    const user = userById.get(agg.userId);
    rows.push({
      date: agg.date,
      userId: agg.userId,
      employee: user?.employee ?? "Unknown",
      userGroup: user?.userGroup ?? "Unassigned",
      salesRole: user ? classifySalesRole(user.userGroup, user.id, agg.costCentre) : "Secondary Sales",
      costCentre: agg.costCentre,
      customerId: agg.customerId,
      customerName: outlet?.name ?? "Unknown Outlet",
      territory: outlet?.territory ?? "Unassigned",
      latitude: outlet?.latitude ?? null,
      longitude: outlet?.longitude ?? null,
      revenue: Math.round(agg.revenue * 100) / 100,
      qty: agg.qty,
      productive: agg.productive,
      visitType: Array.from(agg.visitTypes).sort().join(", "),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// JP Adherence — planned vs actual (build_jp_adherence).
// ---------------------------------------------------------------------------

export interface JpAdherenceDetailRow {
  date: Date;
  monthLabel: string;
  day: string;
  employeeCode: string;
  employeeName: string;
  userGroup: string;
  salesRole: string;
  costCentre: string;
  principalCostCentre: string;
  customerId: string;
  customerName: string;
  territory: string;
  plannedFlag: boolean;
  visitedFlag: boolean;
  productiveFlag: boolean;
  visitType: string;
  revenue: number;
  qty: number;
  jpStatus: "Planned & Productive" | "Planned & Visited" | "Planned Not Visited" | "Unplanned Visit";
  latitude: number | null;
  longitude: number | null;
}

export interface JpAdherenceSummaryRow {
  date: Date;
  monthLabel: string;
  employeeCode: string;
  employeeName: string;
  userGroup: string;
  salesRole: string;
  costCentre: string;
  outletsPlanned: number;
  outletsVisited: number;
  jpAdherencePct: number;
  productiveOutlets: number;
  strikeRatePct: number;
  plannedNotVisited: number;
  visitedNotPlanned: number;
  totalActualVisits: number;
  status: "Excellent" | "Good" | "Below Target";
}

const FULL_DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function dayNameUtc(date: Date): string {
  return FULL_DAY_NAMES[date.getUTCDay()];
}

/** Matches on (Date, UserID, CustomerID). Actual activity is already
 *  aggregated to one row per that key (aggregateActualVisits), so multiple
 *  SKU lines the same day/outlet were already collapsed before this ever
 *  runs. Every summary count below is a DISTINCT CustomerID count, never a
 *  summed row count. */
export function buildJpAdherence(plan: JourneyPlanRow[], actual: ActualVisit[]): { detail: JpAdherenceDetailRow[]; summary: JpAdherenceSummaryRow[] } {
  const actualByKey = new Map<string, ActualVisit>();
  for (const a of actual) actualByKey.set(`${a.date}|${a.userId}|${a.customerId}`, a);

  const plannedSeen = new Set<string>();
  const plannedUnique: JourneyPlanRow[] = [];
  for (const p of plan) {
    const dateKey = p.date.toISOString().slice(0, 10);
    const key = `${p.employeeCode}|${p.customerId}|${dateKey}`;
    if (plannedSeen.has(key)) continue;
    plannedSeen.add(key);
    plannedUnique.push(p);
  }

  const detail: JpAdherenceDetailRow[] = [];
  const plannedKeys = new Set<string>();

  for (const p of plannedUnique) {
    const dateKey = p.date.toISOString().slice(0, 10);
    const matchKey = `${dateKey}|${p.employeeCode}|${p.customerId}`;
    plannedKeys.add(matchKey);
    const a = actualByKey.get(matchKey);
    const visited = a !== undefined;
    const productive = visited && a!.productive;
    detail.push({
      date: p.date,
      monthLabel: p.monthLabel,
      day: p.day,
      employeeCode: p.employeeCode,
      employeeName: p.employeeName,
      userGroup: p.userGroup,
      salesRole: p.salesRole,
      costCentre: p.principalCostCentre,
      principalCostCentre: p.principalCostCentre,
      customerId: p.customerId,
      customerName: p.customerName,
      territory: p.territory,
      plannedFlag: true,
      visitedFlag: visited,
      productiveFlag: productive,
      visitType: a?.visitType ?? "",
      revenue: a?.revenue ?? 0,
      qty: a?.qty ?? 0,
      jpStatus: !visited ? "Planned Not Visited" : productive ? "Planned & Productive" : "Planned & Visited",
      latitude: p.latitude,
      longitude: p.longitude,
    });
  }

  for (const a of actual) {
    const matchKey = `${a.date}|${a.userId}|${a.customerId}`;
    if (plannedKeys.has(matchKey)) continue;
    const date = new Date(`${a.date}T00:00:00.000Z`);
    detail.push({
      date,
      monthLabel: `${MONTH_ABBR[date.getUTCMonth()]}-${date.getUTCFullYear()}`,
      day: dayNameUtc(date),
      employeeCode: a.userId,
      employeeName: a.employee,
      userGroup: a.userGroup,
      salesRole: a.salesRole,
      costCentre: a.costCentre,
      principalCostCentre: a.costCentre,
      customerId: a.customerId,
      customerName: a.customerName,
      territory: a.territory,
      plannedFlag: false,
      visitedFlag: true,
      productiveFlag: a.productive,
      visitType: a.visitType,
      revenue: a.revenue,
      qty: a.qty,
      jpStatus: "Unplanned Visit",
      latitude: a.latitude,
      longitude: a.longitude,
    });
  }

  interface SumAgg {
    date: Date;
    monthLabel: string;
    employeeCode: string;
    employeeName: string;
    userGroup: string;
    salesRole: string;
    costCentre: string;
    plannedIds: Set<string>;
    visitedIds: Set<string>;
    productiveIds: Set<string>;
    visitedNotPlannedIds: Set<string>;
    totalActualIds: Set<string>;
  }
  const sumByKey = new Map<string, SumAgg>();

  for (const d of detail) {
    const dateKey = d.date.toISOString().slice(0, 10);
    const k = `${dateKey}|${d.employeeCode}`;
    let agg = sumByKey.get(k);
    if (!agg) {
      agg = {
        date: d.date,
        monthLabel: d.monthLabel,
        employeeCode: d.employeeCode,
        employeeName: d.employeeName,
        userGroup: d.userGroup,
        salesRole: d.salesRole,
        costCentre: d.costCentre,
        plannedIds: new Set(),
        visitedIds: new Set(),
        productiveIds: new Set(),
        visitedNotPlannedIds: new Set(),
        totalActualIds: new Set(),
      };
      sumByKey.set(k, agg);
    }
    if (d.plannedFlag) agg.plannedIds.add(d.customerId);
    if (d.plannedFlag && d.visitedFlag) agg.visitedIds.add(d.customerId);
    if (d.plannedFlag && d.productiveFlag) agg.productiveIds.add(d.customerId);
    if (!d.plannedFlag) agg.visitedNotPlannedIds.add(d.customerId);
    if (d.visitedFlag) agg.totalActualIds.add(d.customerId);
  }

  const summary: JpAdherenceSummaryRow[] = Array.from(sumByKey.values())
    .map((agg): JpAdherenceSummaryRow => {
      const outletsPlanned = agg.plannedIds.size;
      const outletsVisited = agg.visitedIds.size;
      const productiveOutlets = agg.productiveIds.size;
      const visitedNotPlanned = agg.visitedNotPlannedIds.size;
      const totalActualVisits = agg.totalActualIds.size;
      const plannedNotVisited = Math.max(0, outletsPlanned - outletsVisited);
      const jpAdherencePct = outletsPlanned > 0 ? outletsVisited / outletsPlanned : 0;
      const strikeRatePct = outletsVisited > 0 ? productiveOutlets / outletsVisited : 0;
      const status = jpAdherencePct >= 0.9 ? "Excellent" : jpAdherencePct >= 0.75 ? "Good" : "Below Target";
      return {
        date: agg.date,
        monthLabel: agg.monthLabel,
        employeeCode: agg.employeeCode,
        employeeName: agg.employeeName,
        userGroup: agg.userGroup,
        salesRole: agg.salesRole,
        costCentre: agg.costCentre,
        outletsPlanned,
        outletsVisited,
        jpAdherencePct,
        productiveOutlets,
        strikeRatePct,
        plannedNotVisited,
        visitedNotPlanned,
        totalActualVisits,
        status,
      };
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.costCentre.localeCompare(b.costCentre) || a.employeeName.localeCompare(b.employeeName));

  return { detail, summary };
}

// ---------------------------------------------------------------------------
// Monthly Split (monthly_split) — Month x CostCentre x SalesRole x Rep x
// ActivityStatus, flat rows, no Sub Total/TOTAL.
// ---------------------------------------------------------------------------

export interface MonthlySplitRow {
  monthLabel: string;
  monthIndex: number;
  year: string;
  costCentre: string;
  salesRole: string;
  employeeCode: string;
  employeeName: string;
  activityStatus: "Active" | "Inactive";
  coverage: number;
  productive: number;
  productivityPct: number;
  revenue: number;
  qty: number;
}

/** Coverage counts every outlet a rep touched (a real sale/order OR a
 *  no-sale visit) under a Cost Centre; Productive counts only outlets with a
 *  real positive sale/order that month — this is the same "calls made vs
 *  productive calls" distinction already established for Active Outlets/
 *  Timestamps, applied here at the monthly-rollup grain. A no-sale visit has
 *  no SKU of its own to resolve a Cost Centre from, so it's attributed to
 *  the rep's MODAL (most frequent) Cost Centre+Role for that month — same
 *  inference technique scripts/db-bridge/coverage/transform.ts already uses
 *  for its own no-sale rows. ActivityStatus is evaluated once per outlet
 *  (last real purchase >=3 calendar months before windowEnd => Inactive),
 *  from purchase events only. */
export function buildMonthlySplit(events: PurchaseEvent[], noSaleVisits: NoSaleVisitRow[], users: UserRow[], windowEnd: Date): MonthlySplitRow[] {
  const mapped = events.filter((e) => e.costCentre !== null);
  const userById = new Map(users.map((u) => [u.id, u]));

  const cutoff = new Date(Date.UTC(windowEnd.getUTCFullYear(), windowEnd.getUTCMonth() - 3, windowEnd.getUTCDate()));
  const lastPurchaseByOutlet = new Map<string, Date>();
  for (const e of mapped) {
    const prev = lastPurchaseByOutlet.get(e.customerId);
    if (!prev || e.purchaseDate > prev) lastPurchaseByOutlet.set(e.customerId, e.purchaseDate);
  }
  function activityStatus(customerId: string): "Active" | "Inactive" {
    const last = lastPurchaseByOutlet.get(customerId);
    if (!last) return "Active";
    return last >= cutoff ? "Active" : "Inactive";
  }

  interface Agg {
    monthLabel: string;
    monthIndex: number;
    year: string;
    costCentre: string;
    salesRole: string;
    employeeCode: string;
    employeeName: string;
    activityStatus: "Active" | "Inactive";
    outletIds: Set<string>;
    productiveIds: Set<string>;
    revenue: number;
    qty: number;
  }
  const byKey = new Map<string, Agg>();

  function agg(monthLabel: string, monthIndex: number, year: string, costCentre: string, salesRole: string, userId: string, status: "Active" | "Inactive"): Agg {
    const key = `${monthLabel}|${costCentre}|${salesRole}|${userId}|${status}`;
    let a = byKey.get(key);
    if (!a) {
      a = {
        monthLabel,
        monthIndex,
        year,
        costCentre,
        salesRole,
        employeeCode: userId,
        employeeName: userById.get(userId)?.employee ?? "Unknown",
        activityStatus: status,
        outletIds: new Set(),
        productiveIds: new Set(),
        revenue: 0,
        qty: 0,
      };
      byKey.set(key, a);
    }
    return a;
  }

  // Rep's modal (most frequent) Cost Centre+Role per month, for attributing
  // no-sale-only visits.
  const modalByUserMonth = new Map<string, { costCentre: string; salesRole: string }>();
  {
    const counts = new Map<string, Map<string, number>>();
    for (const e of mapped) {
      const k = `${e.userId}|${e.monthStart}`;
      if (!counts.has(k)) counts.set(k, new Map());
      const inner = counts.get(k)!;
      const ccRole = `${e.costCentre}|${e.salesRole}`;
      inner.set(ccRole, (inner.get(ccRole) ?? 0) + 1);
    }
    for (const [k, inner] of counts) {
      let best: string | null = null;
      let bestCount = -1;
      for (const [ccRole, count] of inner) {
        if (count > bestCount) {
          best = ccRole;
          bestCount = count;
        }
      }
      if (best) {
        const [costCentre, salesRole] = best.split("|");
        modalByUserMonth.set(k, { costCentre, salesRole });
      }
    }
  }

  for (const e of mapped) {
    const status = activityStatus(e.customerId);
    const a = agg(`${MONTH_ABBR[e.monthIndex]}-${e.year}`, e.monthIndex, e.year, e.costCentre!, e.salesRole, e.userId, status);
    a.outletIds.add(e.customerId);
    a.productiveIds.add(e.customerId); // every PurchaseEvent is qty>0 && revenue>0 by construction
    a.revenue += e.revenue;
    a.qty += e.qty;
  }

  for (const v of noSaleVisits) {
    const monthStart = `${v.visitTime.getUTCFullYear()}-${String(v.visitTime.getUTCMonth() + 1).padStart(2, "0")}`;
    const modal = modalByUserMonth.get(`${v.userId}|${monthStart}`);
    if (!modal) continue; // rep had no resolvable Cost Centre that month at all — nothing to attribute this visit to
    const status = activityStatus(v.customerId);
    const monthIndex = v.visitTime.getUTCMonth();
    const a = agg(`${MONTH_ABBR[monthIndex]}-${v.visitTime.getUTCFullYear()}`, monthIndex, String(v.visitTime.getUTCFullYear()), modal.costCentre, modal.salesRole, v.userId, status);
    a.outletIds.add(v.customerId); // touched, not productive
  }

  return Array.from(byKey.values())
    .map((a): MonthlySplitRow => {
      const coverage = a.outletIds.size;
      const productive = a.productiveIds.size;
      return {
        monthLabel: a.monthLabel,
        monthIndex: a.monthIndex,
        year: a.year,
        costCentre: a.costCentre,
        salesRole: a.salesRole,
        employeeCode: a.employeeCode,
        employeeName: a.employeeName,
        activityStatus: a.activityStatus,
        coverage,
        productive,
        productivityPct: coverage > 0 ? productive / coverage : 0,
        revenue: Math.round(a.revenue * 100) / 100,
        qty: a.qty,
      };
    })
    .sort((x, y) => x.monthIndex - y.monthIndex || x.costCentre.localeCompare(y.costCentre) || x.salesRole.localeCompare(y.salesRole) || x.employeeName.localeCompare(y.employeeName));
}
