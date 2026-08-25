// Order 360 aggregation layer. Mirrors the business logic in the user-supplied
// reference dashboard's embedded JS (renderOverview/renderSimpleStagePanel/
// renderDeliveryPanel/renderActionItems/renderReturnsPanel/renderPaymentsPanel)
// but computed here, server-side, from live OrderRecord rows instead of a
// static pre-baked JSON blob. Given the modest row count (3 months of orders,
// ~24k rows), this fetches the filtered window once via Prisma and does every
// funnel/backlog/leaderboard/payments computation with plain array ops — the
// same "fetch once, aggregate in JS" shape the reference dashboard itself uses
// client-side, just moved server-side so every viewer gets the live numbers.
import { prisma } from "@/lib/db";
import { dayNameFromDate } from "@/lib/jpAdherence";
import { getWeeksInMonth } from "@/lib/weeklyTargets";
import type { TeamLeaderScope } from "@/lib/teamLeaderScope";
import { ORDER360_CLEARANCE_ASSIGNMENTS, order360ClearanceAssignment, order360ErpPrefix } from "@/lib/order360Clearance";
import type { Order360ClearanceAssignment } from "@/lib/order360Clearance";
import type { OrderRecord } from "@prisma/client";

export interface Order360Filters {
  /** "YYYY-MM"; null = no month restriction (all loaded history). */
  month: string | null;
  /** Week label from lib/weeklyTargets's getWeeksInMonth (e.g. "Aug Week 1"); requires month. */
  weekLabel: string | null;
  /** Date range (inclusive on both ends); either end may be set alone for an
   *  open-ended range. Takes precedence over month/week when either is set. */
  dateFrom: Date | null;
  dateTo: Date | null;
  /** Mon-Sun subset; empty/null = no day-of-week restriction. */
  dayNames: string[] | null;
}

export interface Order360Meta {
  range: string;
  reportDate: string;
  totalOrders: number;
  totalValue: number;
  /** % of Delivered orders with a confirmed POD/payment record (amountPaid
   *  not null) - see podConfirmedCount/podUnconfirmedCount for the raw split. */
  podConfirmedPct: number;
  podConfirmedCount: number;
  /** Delivered because dispatched (no return logged) but with no POD/payment
   *  record - could be a credit sale (paid outside STK/POD) or a genuinely
   *  unconfirmed/lost delivery. Surfaced as a disclaimer in the UI rather than
   *  silently folded into "Delivered." */
  podUnconfirmedCount: number;
}

export interface Order360FunnelStage {
  stage: string;
  count: number;
}

export interface Order360PerfPerson {
  name: string;
  orders: number;
  value: number;
}

export interface Order360DeliveryDriver {
  name: string;
  deliveredOrders: number;
  deliveredValue: number;
  /** Subset of deliveredOrders with a confirmed POD/payment record vs.
   *  delivered-because-dispatched-only (see Order360Meta.podUnconfirmedCount). */
  confirmedOrders: number;
  unconfirmedOrders: number;
  pendingOrders: number;
  pendingValue: number;
  avgAgePending: number;
  maxAgePending: number;
  returnsCount: number;
  returnsValue: number;
}

export interface Order360BacklogRow {
  ref: string;
  date: string;
  customer: string;
  fsr: string;
  amount: number;
  age: number;
  owner: string;
  erpPrefix?: string | null;
  principal?: string | null;
  returned?: boolean;
  returnType?: string | null;
}

export interface Order360ReturnRow {
  ref: string;
  date: string;
  customer: string;
  fsr: string;
  type: "Full" | "Partial";
  returnDate: string | null;
  amount: number;
  owner: string;
}

export interface Order360PaymentRow {
  ref: string;
  date: string;
  customer: string;
  fsr: string;
  paymentRef: string;
  paymentModes: string[];
  stkPushStatus: "confirmed" | "pending" | "failed" | "not-requested";
  amount: number;
  amountPaid: number;
}

export interface Order360Mismatch extends Order360PaymentRow {
  diff: number;
}

export interface Order360VanStk {
  name: string;
  orders: number;
  value: number;
  totalOrders: number;
  stkPct: number;
}

export interface Order360PaymentMethod {
  method: string;
  orders: number;
  value: number;
}

export interface Order360ClearanceAllocation extends Order360ClearanceAssignment {
  awaitingOrders: number;
  awaitingValue: number;
  clearedOrders: number;
  clearedValue: number;
}

export interface Order360Spotlight {
  name: string;
  dispatched: number;
  delivered: number;
  pending: number;
  returns: number;
  returnsValue: number;
  pendingNonReturn: number;
}

export interface Order360Summary {
  meta: Order360Meta;
  funnel: Order360FunnelStage[];
  perf: {
    clearance: Order360PerfPerson[];
    pick: Order360PerfPerson[];
    dispatch: Order360PerfPerson[];
    audit: Order360PerfPerson[];
    deliveryDrivers: Order360DeliveryDriver[];
  };
  backlog: {
    clearance: Order360BacklogRow[];
    pick: Order360BacklogRow[];
    dispatch: Order360BacklogRow[];
    audit: Order360BacklogRow[];
    delivery: Order360BacklogRow[];
  };
  clearanceAllocation: Order360ClearanceAllocation[];
  returns: {
    totalCount: number;
    totalValue: number;
    byType: { type: "Full" | "Partial"; count: number; value: number }[];
    people: Order360PerfPerson[];
    rows: Order360ReturnRow[];
    spotlight: Order360Spotlight | null;
  };
  payments: {
    stkCount: number;
    stkPendingCount: number;
    stkFailedCount: number;
    noStkCount: number;
    stkValueOrdered: number;
    stkValuePaid: number;
    mismatchCount: number;
    mismatches: Order360Mismatch[];
    byFsr: Order360PerfPerson[];
    byVan: Order360VanStk[];
    methods: Order360PaymentMethod[];
    rows: Order360PaymentRow[];
  };
  availableMonths: string[];
  availableWeeks: string[];
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function ageInDays(orderDate: Date, today: Date): number {
  const ms = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - Date.UTC(orderDate.getUTCFullYear(), orderDate.getUTCMonth(), orderDate.getUTCDate());
  return Math.max(0, Math.round(ms / 86400000));
}

/** Leaderboard person names in the reference render as lowercase
 *  "firstname.lastname" (e.g. "Mary.David"), distinct from the Title Case used
 *  for FSR/customer - a cosmetic convention applied only here, at display time. */
export function dottedName(raw: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed) return "Unassigned";
  return trimmed.split(/\s+/).filter(Boolean).join(".").toLowerCase();
}

function firstNameOf(raw: string): string {
  return raw.trim().split(/\s+/)[0] ?? raw.trim();
}

/** Van display name combines the van reg with the distinct driver first
 *  name(s) who drove it in this window (matches the reference's
 *  "KDE 045L Boaz" / "KDL 733D Purity + Bosco" convention - a van can show
 *  more than one name when it changed drivers mid-window). */
export function vanDisplayName(van: string, driverNames: Iterable<string>): string {
  const seen = new Map<string, string>(); // lowercased first name -> original casing
  for (const d of driverNames) {
    if (!d.trim()) continue;
    const first = firstNameOf(d);
    const key = first.toLowerCase();
    if (!seen.has(key)) seen.set(key, first);
  }
  const names = Array.from(seen.values());
  return names.length ? `${van} ${names.join(" + ")}` : van;
}

/** deliveredBy (the source query's curated "Name - REG" van/driver directory,
 *  keyed off the driver's Pine username) is the authoritative display name
 *  once present; falls back to the van-reg + observed-driver-first-name
 *  derivation only for a van/driver combo the directory doesn't recognize. */
export function resolveDriverName(row: Pick<OrderRecord, "deliveredBy" | "van" | "driver">): string {
  if (row.deliveredBy) return row.deliveredBy;
  return vanDisplayName(row.van || "Unassigned Van", row.driver ? [row.driver] : []);
}

function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function resolveDateRange(now: Date, filters: Order360Filters): { start: Date | null; end: Date | null } | null {
  if (filters.dateFrom || filters.dateTo) {
    // Either end can be left open: "From" alone means "from X through today";
    // "To" alone means "everything up to and including Y." "To" is inclusive,
    // so its upper bound is the start of the next day.
    const start = filters.dateFrom ? utcMidnight(filters.dateFrom) : null;
    const end = filters.dateTo ? new Date(utcMidnight(filters.dateTo).getTime() + 86400000) : null;
    return { start, end };
  }
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const [year, mon] = filters.month.split("-").map(Number);
    if (filters.weekLabel) {
      const week = getWeeksInMonth(year, mon - 1).find((w) => w.weekLabel === filters.weekLabel);
      if (week) return { start: week.weekStartDate, end: new Date(week.weekStartDate.getTime() + 7 * 86400000) };
    }
    return { start: new Date(Date.UTC(year, mon - 1, 1)), end: new Date(Date.UTC(year, mon, 1)) };
  }
  return null;
}

/** Invoiced -> Cleared -> Picked -> Dispatched -> Audited -> Delivered, each a
 *  plain count of the boolean flag being true (Invoiced = every row). */
export function computeFunnel(rows: OrderRecord[]): Order360FunnelStage[] {
  return [
    { stage: "Invoiced", count: rows.length },
    { stage: "Cleared", count: rows.filter((r) => r.cleared).length },
    { stage: "Picked", count: rows.filter((r) => r.picked).length },
    { stage: "Dispatched", count: rows.filter((r) => r.dispatched).length },
    { stage: "Audited", count: rows.filter((r) => r.audited).length },
    { stage: "Delivered", count: rows.filter((r) => r.delivered).length },
  ];
}

/** Pending per stage = "reached the prior gate, not yet this one." */
export function computePendingBacklogs(rows: OrderRecord[]): { clearance: OrderRecord[]; pick: OrderRecord[]; dispatch: OrderRecord[]; audit: OrderRecord[]; delivery: OrderRecord[] } {
  return {
    clearance: rows.filter((r) => !r.cleared),
    pick: rows.filter((r) => r.cleared && !r.picked),
    dispatch: rows.filter((r) => r.picked && !r.dispatched),
    audit: rows.filter((r) => r.dispatched && !r.audited),
    delivery: rows.filter((r) => r.audited && !r.delivered),
  };
}

export function groupPerf(rows: OrderRecord[], nameField: "clearedBy" | "picker" | "dispatcher" | "auditedBy"): Order360PerfPerson[] {
  const byName = new Map<string, { orders: number; value: number }>();
  for (const r of rows) {
    const name = dottedName(r[nameField]);
    const agg = byName.get(name) ?? { orders: 0, value: 0 };
    agg.orders += 1;
    agg.value += r.amount;
    byName.set(name, agg);
  }
  return Array.from(byName.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.orders - a.orders);
}

export async function getOrder360Summary(now: Date, scope: TeamLeaderScope | null, filters: Order360Filters): Promise<Order360Summary> {
  const range = resolveDateRange(now, filters);
  const orderDateWhere = range ? { ...(range.start ? { gte: range.start } : {}), ...(range.end ? { lt: range.end } : {}) } : undefined;
  const rows = await prisma.orderRecord.findMany({
    where: orderDateWhere ? { orderDate: orderDateWhere } : {},
    orderBy: { orderDate: "desc" },
  });

  const monthRows = await prisma.orderRecord.findMany({ distinct: ["orderDate"], select: { orderDate: true }, orderBy: { orderDate: "asc" } });
  const availableMonths = Array.from(new Set(monthRows.map((r) => r.orderDate.toISOString().slice(0, 7)))).sort();
  const availableWeeks = filters.month && /^\d{4}-\d{2}$/.test(filters.month)
    ? (() => {
        const [year, mon] = filters.month.split("-").map(Number);
        return getWeeksInMonth(year, mon - 1).map((w) => w.weekLabel);
      })()
    : [];

  const dayNameSet = filters.dayNames && filters.dayNames.length > 0 ? new Set(filters.dayNames) : null;
  const scopedRows = rows.filter((r) => {
    if (dayNameSet && !dayNameSet.has(dayNameFromDate(r.orderDate))) return false;
    if (scope && !scope.normalizedNames.has(r.fsr.trim().toLowerCase())) return false;
    return true;
  });

  // ---------- meta + funnel ----------
  const totalOrders = scopedRows.length;
  const totalValue = scopedRows.reduce((s, r) => s + r.amount, 0);
  // "Delivered" includes any non-return dispatched order (see query.ts's header
  // note on the corrected source query) - amountPaid non-null is what actually
  // distinguishes a POD/payment-confirmed delivery from a dispatched-only one.
  const deliveredRows = scopedRows.filter((r) => r.delivered);
  const podConfirmedRows = deliveredRows.filter((r) => r.amountPaid !== null);
  const podUnconfirmedCount = deliveredRows.length - podConfirmedRows.length;
  const podConfirmedPct = deliveredRows.length ? Math.round((podConfirmedRows.length / deliveredRows.length) * 1000) / 10 : 0;

  const dates = scopedRows.map((r) => r.orderDate).sort((a, b) => a.getTime() - b.getTime());
  const rangeLabel = dates.length ? `${ymd(dates[0])} to ${ymd(dates[dates.length - 1])} (as of ${ymd(now)})` : `No orders in this window (as of ${ymd(now)})`;

  const funnel = computeFunnel(scopedRows);

  // ---------- backlog (pending = reached the prior gate, not yet this one) ----------
  const { clearance: pendingClearance, pick: pendingPick, dispatch: pendingDispatch, audit: pendingAudit, delivery: pendingDelivery } = computePendingBacklogs(scopedRows);

  function toBacklogRow(r: OrderRecord, owner: string): Order360BacklogRow {
    const assignment = order360ClearanceAssignment(r.erpNumber);
    return {
      ref: r.erpNumber,
      date: ymd(r.orderDate),
      customer: r.customer,
      fsr: r.fsr,
      amount: r.amount,
      age: ageInDays(r.orderDate, now),
      owner,
      erpPrefix: order360ErpPrefix(r.erpNumber),
      principal: assignment?.principal ?? null,
    };
  }

  const backlog = {
    clearance: pendingClearance.map((r) => toBacklogRow(r, order360ClearanceAssignment(r.erpNumber)?.accountant ?? "Unassigned clearance")),
    pick: pendingPick.map((r) => toBacklogRow(r, "Picking Team")),
    dispatch: pendingDispatch.map((r) => toBacklogRow(r, "Dispatch Team")),
    audit: pendingAudit.map((r) => toBacklogRow(r, "Audit Team")),
    delivery: pendingDelivery.map((r) => ({
      ...toBacklogRow(r, resolveDriverName(r)),
      returned: r.isReturn,
      returnType: r.isReturn ? returnTypeFor(r, scopedRows) : null,
    })),
  };

  const allocationRows = new Map<string, Order360ClearanceAllocation>();
  for (const assignment of ORDER360_CLEARANCE_ASSIGNMENTS) {
    allocationRows.set(assignment.erpPrefix, { ...assignment, awaitingOrders: 0, awaitingValue: 0, clearedOrders: 0, clearedValue: 0 });
  }
  for (const row of scopedRows) {
    const assignment = order360ClearanceAssignment(row.erpNumber);
    if (!assignment) continue;
    const allocation = allocationRows.get(assignment.erpPrefix)!;
    if (row.cleared) {
      allocation.clearedOrders += 1;
      allocation.clearedValue += row.amount;
    } else {
      allocation.awaitingOrders += 1;
      allocation.awaitingValue += row.amount;
    }
  }
  const clearanceAllocation = Array.from(allocationRows.values()).sort((a, b) => b.awaitingValue - a.awaitingValue || a.principal.localeCompare(b.principal));

  // ---------- perf leaderboards ----------
  const perf = {
    clearance: groupPerf(scopedRows.filter((r) => r.cleared), "clearedBy"),
    pick: groupPerf(scopedRows.filter((r) => r.picked), "picker"),
    dispatch: groupPerf(scopedRows.filter((r) => r.dispatched), "dispatcher"),
    audit: groupPerf(scopedRows.filter((r) => r.audited), "auditedBy"),
    deliveryDrivers: buildDeliveryDrivers(scopedRows, pendingDelivery, now),
  };

  // ---------- returns ----------
  const returnRows = scopedRows.filter((r) => r.isReturn);
  const returnTypeCounts = { Full: { count: 0, value: 0 }, Partial: { count: 0, value: 0 } };
  const peopleMap = new Map<string, { orders: number; value: number }>();
  const returnDetailRows: Order360ReturnRow[] = returnRows.map((r) => {
    const type = returnTypeFor(r, scopedRows);
    returnTypeCounts[type].count += 1;
    returnTypeCounts[type].value += Math.abs(r.amount);
    const owner = dottedName(r.returnedBy);
    const agg = peopleMap.get(owner) ?? { orders: 0, value: 0 };
    agg.orders += 1;
    agg.value += Math.abs(r.amount);
    peopleMap.set(owner, agg);
    return {
      ref: r.erpNumber,
      date: ymd(r.orderDate),
      customer: r.customer,
      fsr: r.fsr,
      type,
      returnDate: r.clearedDate ? ymd(r.clearedDate) : ymd(r.orderDate),
      amount: Math.abs(r.amount),
      owner,
    };
  });

  const spotlightDriver = perf.deliveryDrivers
    .filter((d) => d.returnsCount > 0)
    .sort((a, b) => b.returnsCount / Math.max(1, b.pendingOrders) - a.returnsCount / Math.max(1, a.pendingOrders))[0];
  const spotlight: Order360Spotlight | null = spotlightDriver
    ? {
        name: spotlightDriver.name,
        dispatched: spotlightDriver.deliveredOrders + spotlightDriver.pendingOrders,
        delivered: spotlightDriver.deliveredOrders,
        pending: spotlightDriver.pendingOrders,
        returns: spotlightDriver.returnsCount,
        returnsValue: spotlightDriver.returnsValue,
        pendingNonReturn: Math.max(0, spotlightDriver.pendingOrders - spotlightDriver.returnsCount),
      }
    : null;

  const returns = {
    totalCount: returnRows.length,
    totalValue: returnRows.reduce((s, r) => s + Math.abs(r.amount), 0),
    byType: (["Full", "Partial"] as const).map((type) => ({ type, ...returnTypeCounts[type] })),
    people: Array.from(peopleMap.entries())
      .map(([name, v]) => ({ name, orders: v.orders, value: v.value }))
      .sort((a, b) => b.orders - a.orders)
      .map((p) => ({ name: p.name, orders: p.orders, value: p.value })),
    rows: returnDetailRows.sort((a, b) => b.amount - a.amount),
    spotlight,
  };

  // ---------- payments (STK) ----------
  const stkRows = scopedRows.filter((r) => r.stk);
  const stkPendingRows = scopedRows.filter((r) => r.stkPushStatus === "pending");
  const stkFailedRows = scopedRows.filter((r) => r.stkPushStatus === "failed");
  const noStkRows = scopedRows.filter((r) => !r.stk && r.stkPushStatus !== "pending" && r.stkPushStatus !== "failed");
  const mismatches: Order360Mismatch[] = stkRows
    .filter((r) => r.stkAmountPaid !== null && Math.abs(r.amount - (r.stkAmountPaid ?? 0)) > 1)
    .map((r) => ({
      ref: r.erpNumber,
      date: ymd(r.orderDate),
      customer: r.customer,
      fsr: r.fsr,
      paymentRef: r.stkPaymentRef ?? "",
      paymentModes: r.paymentModes?.split("|").map((method) => method.trim()).filter(Boolean) ?? [],
      stkPushStatus: "confirmed" as const,
      amount: r.amount,
      amountPaid: r.stkAmountPaid ?? 0,
      diff: (r.stkAmountPaid ?? 0) - r.amount,
    }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const byFsrMap = new Map<string, { orders: number; value: number }>();
  for (const r of stkRows) {
    const agg = byFsrMap.get(r.fsr) ?? { orders: 0, value: 0 };
    agg.orders += 1;
    agg.value += r.stkAmountPaid ?? 0;
    byFsrMap.set(r.fsr, agg);
  }

  const vanTotals = new Map<string, { stkOrders: number; totalOrders: number; stkValue: number; sample: OrderRecord }>();
  for (const r of scopedRows) {
    if (!r.van) continue;
    const agg = vanTotals.get(r.van) ?? { stkOrders: 0, totalOrders: 0, stkValue: 0, sample: r };
    agg.totalOrders += 1;
    if (r.stk) {
      agg.stkOrders += 1;
      agg.stkValue += r.stkAmountPaid ?? 0;
    }
    vanTotals.set(r.van, agg);
  }
  const byVan: Order360VanStk[] = Array.from(vanTotals.values()).map((v) => ({
    name: resolveDriverName(v.sample),
    orders: v.stkOrders,
    value: v.stkValue,
    totalOrders: v.totalOrders,
    stkPct: v.totalOrders ? Math.round((v.stkOrders / v.totalOrders) * 100) : 0,
  }));

  const paymentMethodMap = new Map<string, { orders: number; value: number }>();
  for (const row of scopedRows) {
    const methods = row.paymentModes?.split("|").map((method) => method.trim()).filter(Boolean) ?? [];
    for (const method of new Set(methods)) {
      const aggregate = paymentMethodMap.get(method) ?? { orders: 0, value: 0 };
      aggregate.orders += 1;
      aggregate.value += row.amountPaid ?? 0;
      paymentMethodMap.set(method, aggregate);
    }
  }

  const payments = {
    stkCount: stkRows.length,
    stkPendingCount: stkPendingRows.length,
    stkFailedCount: stkFailedRows.length,
    noStkCount: noStkRows.length,
    stkValueOrdered: stkRows.reduce((s, r) => s + r.amount, 0),
    stkValuePaid: stkRows.reduce((s, r) => s + (r.stkAmountPaid ?? 0), 0),
    mismatchCount: mismatches.length,
    mismatches,
    byFsr: Array.from(byFsrMap.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.orders - a.orders),
    byVan: byVan.sort((a, b) => b.stkPct - a.stkPct),
    methods: Array.from(paymentMethodMap.entries())
      .map(([method, values]) => ({ method, ...values }))
      .sort((a, b) => b.orders - a.orders || a.method.localeCompare(b.method)),
    rows: stkRows
      .map((r) => ({ ref: r.erpNumber, date: ymd(r.orderDate), customer: r.customer, fsr: r.fsr, paymentRef: r.stkPaymentRef ?? "", paymentModes: r.paymentModes?.split("|").map((method) => method.trim()).filter(Boolean) ?? [], stkPushStatus: "confirmed" as const, amount: r.amount, amountPaid: r.stkAmountPaid ?? 0 }))
      .sort((a, b) => b.amountPaid - a.amountPaid),
  };

  return {
    meta: { range: rangeLabel, reportDate: ymd(now), totalOrders, totalValue, podConfirmedPct, podConfirmedCount: podConfirmedRows.length, podUnconfirmedCount },
    funnel,
    perf,
    backlog,
    clearanceAllocation,
    returns,
    payments,
    availableMonths,
    availableWeeks,
  };
}

/** A return whose |amount| matches the original order's |amount| (matched by
 *  invoiceNumber) fully reversed it - "Full"; anything else is "Partial". Not
 *  derivable from the source query itself (see lib/order360Summary.ts's plan
 *  notes) - this is the one sensible rule available from the data on hand. */
export function returnTypeFor(returnRow: OrderRecord, allRows: OrderRecord[]): "Full" | "Partial" {
  if (!returnRow.invoiceNumber) return "Partial";
  const original = allRows.find((r) => !r.isReturn && r.invoiceNumber === returnRow.invoiceNumber);
  if (original && Math.abs(Math.abs(original.amount) - Math.abs(returnRow.amount)) < 1) return "Full";
  return "Partial";
}

export function buildDeliveryDrivers(allRows: OrderRecord[], pendingDelivery: OrderRecord[], now: Date): Order360DeliveryDriver[] {
  const byVan = new Map<
    string,
    {
      deliveredOrders: number;
      deliveredValue: number;
      confirmedOrders: number;
      unconfirmedOrders: number;
      pendingOrders: number;
      pendingValue: number;
      pendingAges: number[];
      returnsCount: number;
      returnsValue: number;
      sample: OrderRecord;
    }
  >();
  function bucket(r: OrderRecord) {
    const van = r.van!;
    let b = byVan.get(van);
    if (!b) {
      b = { deliveredOrders: 0, deliveredValue: 0, confirmedOrders: 0, unconfirmedOrders: 0, pendingOrders: 0, pendingValue: 0, pendingAges: [], returnsCount: 0, returnsValue: 0, sample: r };
      byVan.set(van, b);
    }
    return b;
  }

  for (const r of allRows) {
    if (!r.van) continue;
    const b = bucket(r);
    if (r.delivered) {
      b.deliveredOrders += 1;
      b.deliveredValue += r.amount;
      if (r.amountPaid !== null) b.confirmedOrders += 1;
      else b.unconfirmedOrders += 1;
    }
    if (r.isReturn) {
      b.returnsCount += 1;
      b.returnsValue += Math.abs(r.amount);
    }
  }
  for (const r of pendingDelivery) {
    if (!r.van) continue;
    const b = bucket(r);
    b.pendingOrders += 1;
    b.pendingValue += r.amount;
    b.pendingAges.push(ageInDays(r.orderDate, now));
  }

  return Array.from(byVan.values())
    .map((b) => ({
      name: resolveDriverName(b.sample),
      deliveredOrders: b.deliveredOrders,
      deliveredValue: b.deliveredValue,
      confirmedOrders: b.confirmedOrders,
      unconfirmedOrders: b.unconfirmedOrders,
      pendingOrders: b.pendingOrders,
      pendingValue: b.pendingValue,
      avgAgePending: b.pendingAges.length ? Math.round((b.pendingAges.reduce((s, a) => s + a, 0) / b.pendingAges.length) * 10) / 10 : 0,
      maxAgePending: b.pendingAges.length ? Math.max(...b.pendingAges) : 0,
      returnsCount: b.returnsCount,
      returnsValue: b.returnsValue,
    }))
    .sort((a, b) => b.pendingValue - a.pendingValue);
}

/** 0-2 good, 3-7 warn, 8+ bad - same ageClass() thresholds as the reference JS. */
export function order360AgeBucket(age: number): "good" | "warn" | "bad" {
  if (age > 7) return "bad";
  if (age >= 3) return "warn";
  return "good";
}
