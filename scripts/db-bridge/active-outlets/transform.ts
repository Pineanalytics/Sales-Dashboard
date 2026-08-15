// Cost Centre resolution, purchase-event collapsing, Sales Role classification,
// and the three output builders (Active Outlets, Active Outlets Monthly, Rep
// Calls) for the direct-SQL Active Outlets + Timestamps modules. Ported from
// the user-supplied Buying_Outlets_By_CostCentre_Extractor script's
// prepare_purchase_events/classify_sales_role/build_period_metrics/
// summarize_events/build_rep_outlet_calls — see the session's implementation
// plan for the line-number mapping back to that script.
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { FactLineRow, NoSaleVisitRow, OutletRow, ProductRow, UserRow } from "./query";

export interface PrincipalRow {
  key: string;
  principal: string;
  mainPrincipal: string;
  location: string;
  locationCode: string;
  status: string;
  teamLeader: string;
}

// Same longest-prefix-first SKU->brand map as scripts/db-bridge/coverage/transform.ts
// (duplicated locally rather than cross-imported between bridge subtrees, matching
// this codebase's existing precedent — e.g. reference/products.ts).
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

/** SKU -> Cost Centre (Principal), matched against the Active principals reference.
 *  Returns null if the SKU has no known brand prefix, or the resolved brand has no
 *  matching Active principal — same "unresolvable" concept as the source script's
 *  UNMAPPED_LABEL. */
export function resolveCostCentre(sapCode: string, principals: PrincipalRow[]): PrincipalRow | null {
  const activeByKey = new Map(principals.filter((p) => p.status === "Active").map((p) => [p.principal, p]));
  const brand = resolveBrandFromSku(sapCode.trim().toUpperCase());
  if (!brand) return null;
  const cleanedBrand = brand.trim().replace(/\.$/, "");
  const fixedKey = applyFixups(`${cleanedBrand}-Nairobi`);
  const referencePrincipal = activeByKey.get(fixedKey);
  if (referencePrincipal) return referencePrincipal;
  // The Pine-connected worker cannot normally reach the dashboard's Postgres
  // reference database. Preserve the canonical SKU-prefix classification in
  // that case; unknown prefixes still remain genuinely unallocated.
  if (principals.length > 0) return null;
  return {
    key: `inferred:${fixedKey}`,
    principal: fixedKey,
    mainPrincipal: cleanedBrand,
    location: "Nairobi",
    locationCode: "",
    status: "Active",
    teamLeader: "",
  };
}

// ---------------------------------------------------------------------------
// Sales Role — the source script's precise rule (classify_sales_role, lines
// 975-996), NOT the existing coverage bridge's simplified MBSR/TDR-only rule.
// ---------------------------------------------------------------------------

const PRIMARY_GROUPS = new Set(["DSR", "KAMS", "TDR", "ADMIN"]);
const SECONDARY_DSR_CODES = new Set(["1172", "1032"]);
const MARS_COST_CENTRE = "mars";

/** costCentre may be the bare brand ("Mars") or a location-suffixed principal
 *  string ("Mars-Nairobi") — checked with startsWith so either form correctly
 *  matches Mars, since resolveCostCentre always produces "<Brand>-<Location>". */
export function classifySalesRole(userGroup: string, userId: string, costCentre: string): "Primary Sales" | "Secondary Sales" {
  const group = userGroup.trim().toUpperCase();
  const isPrimaryGroup = PRIMARY_GROUPS.has(group);
  // A TDR call can contain several Cost Centres. Treat the whole call as
  // Secondary when any product in that basket belongs to Mars, rather than
  // letting whichever product happened to be processed first decide its role.
  const excludedTdrMars = group === "TDR" && costCentre.split(",").some((centre) => centre.trim().toLowerCase().startsWith(MARS_COST_CENTRE));
  const excludedDsrCode = group === "DSR" && SECONDARY_DSR_CODES.has(userId.trim());
  return isPrimaryGroup && !excludedTdrMars && !excludedDsrCode ? "Primary Sales" : "Secondary Sales";
}

// ---------------------------------------------------------------------------
// Purchase events — one distinct document per Cost Centre, SKU lines collapsed.
// ---------------------------------------------------------------------------

export interface PurchaseEvent {
  eventKey: string; // docId + isOrder (+ Cost Centre, when known), unique per document
  docId: string;
  isOrder: boolean;
  purchaseDate: Date; // normalized to midnight
  purchaseTime: Date; // full timestamp, earliest line on the document
  monthStart: string; // "YYYY-MM"
  year: string;
  month: string;
  monthIndex: number;
  customerId: string;
  userId: string;
  // null when the SKU didn't resolve to a known Active principal — the sale itself is
  // still real (qty > 0, price > 0 in pine.sales/orders) and still counts as a call /
  // productive call; it just can't be attributed to a specific Cost Centre. Active
  // Outlets filters these out (that module is inherently per-Cost-Centre); Timestamps
  // does not (a call is productive whenever a real transaction happened, regardless of
  // whether every line on it mapped to a known principal).
  costCentre: string | null;
  salesRole: "Primary Sales" | "Secondary Sales";
  revenue: number;
  qty: number;
  cases: number | null;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface CollapseResult {
  events: PurchaseEvent[];
  unmatchedSkuCount: number;
}

/** Drops only lines whose outlet/rep is genuinely unknown (INNER-join discipline, same
 *  as the source script — there's no one to attribute the call to) or that aren't a
 *  real positive sale/order line. An unrecognized item (unknown itemId) or a SKU that
 *  doesn't resolve to a known Active principal does NOT drop the line — it's still a
 *  real transaction (this is exactly the "Calls Made vs Productive Calls" distinction:
 *  productive means a positive sale/order happened, independent of whether every line
 *  on it could be attributed to a specific Cost Centre). Cost Centre resolution only
 *  gates the `costCentre` field (null when unresolved); `unmatchedSkuCount` still counts
 *  these for diagnostic visibility. SKU lines are then collapsed into one purchase event
 *  per document + Cost Centre (or one "unmapped" event per document for lines whose SKU
 *  never resolved). */
export function collapseToPurchaseEvents(
  lines: FactLineRow[],
  outlets: OutletRow[],
  users: UserRow[],
  products: ProductRow[],
  principals: PrincipalRow[]
): CollapseResult {
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));
  const productByItemId = new Map(products.map((p) => [p.id, p]));

  interface LineEvent {
    key: string;
    docId: string;
    isOrder: boolean;
    date: Date;
    time: Date;
    customerId: string;
    userId: string;
    costCentre: string | null;
    revenue: number;
    qty: number;
    cases: number | null;
  }
  const lineEvents: LineEvent[] = [];
  let unmatchedSkuCount = 0;

  for (const line of lines) {
    const outlet = outletById.get(line.customerId);
    const user = userById.get(line.userId);
    if (!outlet || !user) continue;
    if (!(line.qty > 0 && line.unitPrice > 0)) continue;

    const product = productByItemId.get(line.itemId);
    const sapCode = product?.sapCode;
    const costCentreRow = sapCode ? resolveCostCentre(sapCode, principals) : null;
    if (!costCentreRow) unmatchedSkuCount++;

    lineEvents.push({
      key: `${line.docId}|${line.isOrder ? 1 : 0}|${costCentreRow ? costCentreRow.principal : "UNMAPPED"}`,
      docId: line.docId,
      isOrder: line.isOrder,
      date: new Date(Date.UTC(line.purchaseTime.getUTCFullYear(), line.purchaseTime.getUTCMonth(), line.purchaseTime.getUTCDate())),
      time: line.purchaseTime,
      customerId: line.customerId,
      userId: line.userId,
      costCentre: costCentreRow ? costCentreRow.principal : null,
      revenue: Math.round(line.qty * line.unitPrice * 100) / 100,
      qty: line.qty,
      cases: product?.unitsPerCase ? line.qty / product.unitsPerCase : null,
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
      docId: first.docId,
      isOrder: first.isOrder,
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
      cases: group.every((g) => g.cases !== null) ? group.reduce((s, g) => s + (g.cases ?? 0), 0) : null,
    });
  }

  return { events, unmatchedSkuCount };
}

// ---------------------------------------------------------------------------
// Active Outlets — one ledger row per purchase event (ActiveOutletEvent),
// NOT an aggregated outlet-level summary. The old in-memory Map-accumulation
// (this function used to build ActiveOutletRow[] directly) moved server-side
// as a SQL aggregate over this ledger (see app/api/active-outlets/upload's
// derivation query) — deriving timesBought/purchaseDays/activeMonths as
// COUNT/COUNT DISTINCT is only correct if it's computed from every event
// ever recorded, which an incremental sync's small fetch window can't
// provide on its own; the ledger is what makes that safe.
// ---------------------------------------------------------------------------

export interface ActiveOutletEventRow {
  year: string;
  principal: string;
  customerId: string;
  docId: string;
  isOrder: boolean;
  date: Date; // midnight-normalized, matches the old purchaseDate semantics
  sales: number;
  qty: number;
  salesRole: "Primary Sales" | "Secondary Sales";
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  latitude: number | null;
  longitude: number | null;
  /** Pine's PJP owner. Principal remains SKU-derived above; it is never
   * inferred from this owner. The field-form sync independently resolves an
   * active roster match and leaves dormant owners unassigned. */
  pjpEmployeeCode: string | null;
  pjpRepName: string | null;
  pjpRepGroup: string | null;
  pjpRegion: string | null;
  repName: string | null;
  repGroup: string | null;
}

/** Active Outlets is inherently per-Cost-Centre — an event whose SKU never
 *  resolved to a known principal (costCentre: null) can't be attributed
 *  here (it still counts as a call/productive call on the Timestamps side,
 *  which doesn't need Cost Centre attribution). */
export function buildActiveOutletEvents(
  events: PurchaseEvent[],
  outlets: OutletRow[],
  users: UserRow[]
): ActiveOutletEventRow[] {
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const rows: ActiveOutletEventRow[] = [];
  for (const e of events) {
    if (e.costCentre === null) continue;
    const outlet = outletById.get(e.customerId);
    const user = userById.get(e.userId);
    rows.push({
      year: e.year,
      principal: e.costCentre,
      customerId: e.customerId,
      docId: e.docId,
      isOrder: e.isOrder,
      date: e.purchaseDate,
      sales: Math.round(e.revenue * 100) / 100,
      qty: e.qty,
      salesRole: e.salesRole,
      outletName: outlet?.name ?? "Unknown Outlet",
      channel: outlet ? resolveChannel(outlet.subChannel, outlet.sourceChannel) : "Retail",
      subChannel: outlet?.subChannel ?? "Unknown",
      territory: outlet?.territory ?? "Unassigned",
      latitude: outlet?.latitude ?? null,
      longitude: outlet?.longitude ?? null,
      pjpEmployeeCode: outlet?.pjpUserId ?? null,
      pjpRepName: outlet?.pjpRepName ?? null,
      pjpRepGroup: outlet?.pjpRepGroup ?? null,
      pjpRegion: outlet?.pjpRegion ?? null,
      repName: user?.employee ?? null,
      repGroup: user?.userGroup ?? null,
    });
  }
  return rows;
}

// Sub Channel -> Channel roll-up, verbatim from the source script (lines 661-673).
const SUBCHANNEL_TO_CHANNEL: Record<string, string> = {
  Retailers: "Retail",
  Wholesalers: "Wholesale",
  Horeca: "Wholesale",
  Institutions: "Wholesale",
  "Baby Shop": "Retail",
  "Beauty Shop": "Retail",
  Pharmacies: "Retail",
  "Liquor Shops": "Retail",
  Minimart: "Wholesale",
  Supermarkets: "Wholesale",
};

function resolveChannel(subChannel: string, sourceChannel: string): string {
  return SUBCHANNEL_TO_CHANNEL[subChannel] ?? (sourceChannel || "Retail");
}

// ---------------------------------------------------------------------------
// Active Outlets Monthly — distinct outlets RE-COUNTED per Month+Principal+
// SalesRole (never summed from ActiveOutlet — see schema comment).
// ---------------------------------------------------------------------------

export interface ActiveOutletMonthlyRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  distinctOutlets: number;
  transactions: number;
  sales: number;
}

export function buildActiveOutletsMonthly(events: PurchaseEvent[]): ActiveOutletMonthlyRow[] {
  interface Agg {
    year: string;
    month: string;
    monthIndex: number;
    principal: string;
    salesRole: "Primary Sales" | "Secondary Sales";
    outlets: Set<string>;
    eventKeys: Set<string>;
    sales: number;
  }
  const byKey = new Map<string, Agg>();
  for (const e of events) {
    if (e.costCentre === null) continue; // see buildActiveOutletEvents — same per-Cost-Centre scoping
    const key = `${e.year}|${e.month}|${e.costCentre}|${e.salesRole}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        year: e.year,
        month: e.month,
        monthIndex: e.monthIndex,
        principal: e.costCentre,
        salesRole: e.salesRole,
        outlets: new Set(),
        eventKeys: new Set(),
        sales: 0,
      };
      byKey.set(key, agg);
    }
    agg.outlets.add(e.customerId);
    agg.eventKeys.add(e.eventKey);
    agg.sales += e.revenue;
  }
  return Array.from(byKey.values()).map((agg) => ({
    year: agg.year,
    month: agg.month,
    monthIndex: agg.monthIndex,
    principal: agg.principal,
    salesRole: agg.salesRole,
    distinctOutlets: agg.outlets.size,
    transactions: agg.eventKeys.size,
    sales: Math.round(agg.sales * 100) / 100,
  }));
}

// ---------------------------------------------------------------------------
// Rep Calls — one row per Rep x Outlet x Day (build_rep_outlet_calls).
// ---------------------------------------------------------------------------

export interface RepCallRow {
  date: Date;
  employeeCode: string;
  salesRep: string;
  employeeGroup: string;
  salesRole: "Primary Sales" | "Secondary Sales";
  region: string;
  callSequence: number;
  callTime: Date;
  callOutcome: "Sale" | "No Sale";
  noSaleReason: string | null;
  outletId: string;
  outletName: string;
  channel: string;
  subChannel: string;
  territory: string;
  costCentresBought: string;
  intervalMins: number | null;
  documents: number;
  sales: number;
  qty: number;
  cases: number | null;
  firstCallOfDay: Date;
  lastCallOfDay: Date;
  hoursInDay: number;
  callsInDay: number;
  productiveInDay: number;
}

export function buildRepCalls(
  monthEvents: PurchaseEvent[],
  noSaleVisits: NoSaleVisitRow[],
  outlets: OutletRow[],
  users: UserRow[]
): RepCallRow[] {
  const outletById = new Map(outlets.map((o) => [o.id, o]));
  const userById = new Map(users.map((u) => [u.id, u]));

  interface CallAgg {
    dateKey: string;
    date: Date;
    userId: string;
    customerId: string;
    saleTime: Date | null;
    noSaleTime: Date | null;
    documents: Set<string>;
    sales: number;
    qty: number;
    cases: number;
    hasUnknownCases: boolean;
    costCentres: Set<string>;
    noSaleReason: string | null;
  }
  const byKey = new Map<string, CallAgg>();

  function keyFor(dateKey: string, userId: string, customerId: string) {
    return `${dateKey}|${userId}|${customerId}`;
  }

  for (const e of monthEvents) {
    const dateKey = e.purchaseDate.toISOString().slice(0, 10);
    const k = keyFor(dateKey, e.userId, e.customerId);
    let agg = byKey.get(k);
    if (!agg) {
      agg = {
        dateKey,
        date: e.purchaseDate,
        userId: e.userId,
        customerId: e.customerId,
        saleTime: e.purchaseTime,
        noSaleTime: null,
        documents: new Set(),
        sales: 0,
        qty: 0,
        cases: 0,
        hasUnknownCases: false,
        costCentres: new Set(),
        noSaleReason: null,
      };
      byKey.set(k, agg);
    }
    if (!agg.saleTime || e.purchaseTime < agg.saleTime) agg.saleTime = e.purchaseTime;
    agg.documents.add(e.eventKey);
    agg.sales += e.revenue;
    agg.qty += e.qty;
    if (e.cases === null) agg.hasUnknownCases = true;
    else agg.cases += e.cases;
    if (e.costCentre !== null) agg.costCentres.add(e.costCentre);
  }

  for (const v of noSaleVisits) {
    const dateKey = new Date(Date.UTC(v.visitTime.getUTCFullYear(), v.visitTime.getUTCMonth(), v.visitTime.getUTCDate())).toISOString().slice(0, 10);
    const k = keyFor(dateKey, v.userId, v.customerId);
    let agg = byKey.get(k);
    if (!agg) {
      agg = {
        dateKey,
        date: new Date(Date.UTC(v.visitTime.getUTCFullYear(), v.visitTime.getUTCMonth(), v.visitTime.getUTCDate())),
        userId: v.userId,
        customerId: v.customerId,
        saleTime: null,
        noSaleTime: v.visitTime,
        documents: new Set(),
        sales: 0,
        qty: 0,
        cases: 0,
        hasUnknownCases: false,
        costCentres: new Set(),
        noSaleReason: v.noSaleReason,
      };
      byKey.set(k, agg);
    } else if (!agg.noSaleTime || v.visitTime < agg.noSaleTime) {
      agg.noSaleTime = v.visitTime;
      agg.noSaleReason = v.noSaleReason;
    }
  }

  // Group calls by Rep+Day to sequence them and compute day-level stats.
  const byRepDay = new Map<string, CallAgg[]>();
  for (const agg of byKey.values()) {
    const k = `${agg.dateKey}|${agg.userId}`;
    if (!byRepDay.has(k)) byRepDay.set(k, []);
    byRepDay.get(k)!.push(agg);
  }

  const rows: RepCallRow[] = [];
  for (const dayAggs of byRepDay.values()) {
    const withTime = dayAggs
      .map((agg) => ({ agg, callTime: agg.saleTime && agg.noSaleTime ? (agg.saleTime < agg.noSaleTime ? agg.saleTime : agg.noSaleTime) : agg.saleTime ?? agg.noSaleTime! }))
      .sort((a, b) => a.callTime.getTime() - b.callTime.getTime());

    const firstCallOfDay = withTime[0].callTime;
    const lastCallOfDay = withTime[withTime.length - 1].callTime;
    const hoursInDay = Math.round(((lastCallOfDay.getTime() - firstCallOfDay.getTime()) / 3600000) * 100) / 100;
    const callsInDay = withTime.length;
    const productiveInDay = withTime.filter((w) => w.agg.documents.size > 0).length;

    const user = userById.get(withTime[0].agg.userId);
    let previousCallTime: Date | null = null;

    withTime.forEach((w, i) => {
      const outlet = outletById.get(w.agg.customerId);
      const documents = w.agg.documents.size;
      const outcome: "Sale" | "No Sale" = documents > 0 ? "Sale" : "No Sale";
      const intervalMins = previousCallTime ? Math.round(((w.callTime.getTime() - previousCallTime.getTime()) / 60000) * 10) / 10 : null;
      previousCallTime = w.callTime;

      const costCentresBought = Array.from(w.agg.costCentres).sort().join(", ");
      const salesRole = classifySalesRole(user?.userGroup ?? "", w.agg.userId, costCentresBought);

      rows.push({
        date: w.agg.date,
        employeeCode: w.agg.userId,
        salesRep: user?.employee ?? "Unknown",
        employeeGroup: user?.userGroup ?? "Unassigned",
        salesRole,
        region: user?.region ?? "Unassigned",
        callSequence: i + 1,
        callTime: w.callTime,
        callOutcome: outcome,
        noSaleReason: outcome === "No Sale" ? w.agg.noSaleReason : null,
        outletId: w.agg.customerId,
        outletName: outlet?.name ?? "Unknown Outlet",
        channel: outlet ? resolveChannel(outlet.subChannel, outlet.sourceChannel) : "Retail",
        subChannel: outlet?.subChannel ?? "Unknown",
        territory: outlet?.territory ?? "Unassigned",
        costCentresBought,
        intervalMins,
        documents,
        sales: Math.round(w.agg.sales * 100) / 100,
        qty: w.agg.qty,
        cases: outcome === "Sale" && !w.agg.hasUnknownCases ? Math.round(w.agg.cases * 100) / 100 : outcome === "No Sale" ? 0 : null,
        firstCallOfDay,
        lastCallOfDay,
        hoursInDay,
        callsInDay,
        productiveInDay,
      });
    });
  }

  return rows;
}
