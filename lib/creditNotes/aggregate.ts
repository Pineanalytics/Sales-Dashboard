// Turns the stored SAP document lines into the Credit Notes & Returns report.
// Pure: no database, no clock. The caller passes the lines (already narrowed to
// the principals and scope the viewer may see) and the months of the selected
// period; everything here is arithmetic over them, so it is unit-tested directly.
import type { PerfLine } from "@/lib/performanceAnalysis/types";
import type {
  CreditCustomerRow,
  CreditItemRow,
  CreditLineRow,
  CreditMonthRow,
  CreditNoteKpi,
  CreditNotesPayload,
  CreditNoteTotals,
  CreditPrincipalRow,
  CreditRepRow,
  CreditWarehouseRow,
} from "./types";

/** How many months the trend spans at most, ending with the period's last month. */
export const TREND_MONTHS = 12;
const DEFAULT_TOP_ITEMS = 50;
const DEFAULT_TOP_CUSTOMERS = 50;
const DEFAULT_TOP_LINES = 100;
/** A rep, principal or branch needs this share of the total invoiced to be called out for a high rate (so a tiny account is not "the worst"). */
const MATERIAL_INVOICED_SHARE = 0.01;

export interface CreditNotesOptions {
  asOf: string;
  /** YYYY-MM months of the selected period, already limited to those the SAP read covers. */
  scopeMonths: string[];
  /** Free text matched against customer, item, rep, principal and branch (case-insensitive). */
  query?: string;
  /** Months the stored SAP read covers at all, before any principal, scope or text filter. A filter can leave a month with no lines
   *  for a small selection; that must not make the comparison window look uncovered. Defaults to the months present in `lines`. */
  coveredMonths?: Iterable<string>;
  /** Cut the item and customer lists to this many rows; omit for the display default, Infinity for the export. */
  topItems?: number;
  topCustomers?: number;
  topLines?: number;
}

/** The month `offset` months from `month` (YYYY-MM), negative for earlier. */
export function shiftMonth(month: string, offset: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + offset;
  const shiftedYear = year + Math.floor(index / 12);
  const shiftedIndex = ((index % 12) + 12) % 12;
  return `${shiftedYear}-${String(shiftedIndex + 1).padStart(2, "0")}`;
}

/** The `count` months ending just before `firstMonth`, oldest first. */
export function priorWindow(firstMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(firstMonth, i - count));
}

/** Whether a line matches a free-text filter (empty matches everything). */
export function lineMatchesQuery(line: PerfLine, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    line.customerCode.toLowerCase().includes(needle) ||
    line.customerName.toLowerCase().includes(needle) ||
    line.itemCode.toLowerCase().includes(needle) ||
    line.itemName.toLowerCase().includes(needle) ||
    line.rep.toLowerCase().includes(needle) ||
    line.principal.toLowerCase().includes(needle) ||
    line.warehouse.toLowerCase().includes(needle)
  );
}

class Totals {
  creditRaw = 0;
  invoiced = 0;
  cases = 0;
  gp = 0;
  creditLines = 0;
  customers = new Set<string>();
  items = new Set<string>();
  principals = new Set<string>();
  reps = new Set<string>();

  add(line: PerfLine): void {
    if (line.doc === "credit") {
      this.creditRaw += line.sales;
      this.cases += line.cases;
      this.gp += line.gp;
      this.creditLines += 1;
      this.customers.add(line.customerCode);
      this.items.add(line.itemCode);
      this.principals.add(line.principal);
      this.reps.add(line.rep);
    } else {
      this.invoiced += line.sales;
    }
  }

  get credit(): number {
    return -this.creditRaw || 0; // `|| 0` keeps an empty slice at +0, not -0
  }

  totals(): CreditNoteTotals {
    const credit = this.credit;
    return {
      credit,
      invoiced: this.invoiced,
      cnPct: this.invoiced > 0 ? (credit / this.invoiced) * 100 : null,
      cases: -this.cases || 0,
      gpLost: -this.gp || 0,
      creditLines: this.creditLines,
    };
  }
}

function changePct(current: number, prior: number | null): number | null {
  return prior !== null && prior > 0 ? ((current - prior) / prior) * 100 : null;
}

/** Groups the in-scope lines by a key, and the prior window's credit by the same key. */
function group(lines: PerfLine[], priorLines: PerfLine[], key: (line: PerfLine) => string): { groups: Map<string, Totals>; prior: Map<string, number> } {
  const groups = new Map<string, Totals>();
  for (const line of lines) {
    const k = key(line);
    let entry = groups.get(k);
    if (!entry) groups.set(k, (entry = new Totals()));
    entry.add(line);
  }
  const prior = new Map<string, number>();
  for (const line of priorLines) {
    if (line.doc !== "credit") continue;
    const k = key(line);
    prior.set(k, (prior.get(k) ?? 0) - line.sales || 0);
  }
  return { groups, prior };
}

/** The key with the largest credit among a map of key -> credit. */
function dominant(credits: Map<string, number> | undefined): string {
  let best = "";
  let bestValue = -Infinity;
  for (const [name, value] of credits ?? []) {
    if (value > bestValue) {
      best = name;
      bestValue = value;
    }
  }
  return best;
}

function fmtKes(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `KES ${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `KES ${(value / 1e3).toFixed(0)}K`;
  return `KES ${Math.round(value)}`;
}

function fmtPct(value: number | null, places = 1): string {
  return value === null || !Number.isFinite(value) ? "–" : `${value.toFixed(places)}%`;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (month: string): string => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month} ${month.slice(0, 4)}`;

/** An empty report shell, so callers need not special-case a selection with no lines. */
function emptyKpi(): CreditNoteKpi {
  return {
    credit: 0, invoiced: 0, cnPct: null, cases: 0, gpLost: 0, creditLines: 0, net: 0, customers: 0, items: 0, reps: 0, principals: 0,
    avgPerCustomer: null, priorCredit: null, creditChangePct: null, priorCnPct: null, cnPctChange: null, top10CustomerShare: null, itemsCreditedAboveInvoiced: 0,
  };
}

export function aggregateCreditNotes(allLines: PerfLine[], options: CreditNotesOptions): CreditNotesPayload {
  const scope = Array.from(new Set(options.scopeMonths)).sort();
  const query = options.query ?? "";
  const lines = query.trim() ? allLines.filter((line) => lineMatchesQuery(line, query)) : allLines;
  const scopeSet = new Set(scope);

  if (scope.length === 0) {
    return { asOf: options.asOf, months: [], scope, priorScope: [], mtd: false, kpi: emptyKpi(), monthly: [], principals: [], items: [], customers: [], reps: [], warehouses: [], topLines: [], itemCount: 0, customerCount: 0, insights: [] };
  }

  const first = scope[0];
  const last = scope[scope.length - 1];

  // The prior window is only used when the stored lines cover every one of its months; a partial window would
  // understate the prior credit and turn the comparison into a false rise.
  const priorMonths = priorWindow(first, scope.length);
  const monthsWithLines = new Set(options.coveredMonths ?? allLines.map((line) => line.month));
  const priorCovered = priorMonths.every((month) => monthsWithLines.has(month));
  const priorSet = new Set(priorCovered ? priorMonths : []);
  const priorScope = priorCovered ? priorMonths : [];

  const inScope = lines.filter((line) => scopeSet.has(line.month));
  const priorLines = priorCovered ? lines.filter((line) => priorSet.has(line.month)) : [];

  // ---- headline ----
  const whole = new Totals();
  for (const line of inScope) whole.add(line);
  const wholeTotals = whole.totals();
  const priorWhole = new Totals();
  for (const line of priorLines) priorWhole.add(line);
  const priorCredit = priorCovered ? priorWhole.credit : null;
  const priorTotals = priorWhole.totals();

  // ---- customers ----
  const customerGroups = group(inScope, priorLines, (line) => line.customerCode);
  const customerNames = new Map<string, string>();
  const customerReps = new Map<string, Map<string, number>>();
  for (const line of inScope) {
    if (!customerNames.has(line.customerCode) || (line.doc === "invoice" && line.customerName)) customerNames.set(line.customerCode, line.customerName || line.customerCode);
    if (line.doc !== "credit") continue;
    let reps = customerReps.get(line.customerCode);
    if (!reps) customerReps.set(line.customerCode, (reps = new Map()));
    reps.set(line.rep, (reps.get(line.rep) ?? 0) - line.sales);
  }
  const customerRowsAll = Array.from(customerGroups.groups.entries())
    .filter(([, totals]) => totals.creditLines > 0)
    .sort((a, b) => b[1].credit - a[1].credit);
  const creditedCustomerCount = customerRowsAll.length;
  let running = 0;
  const customers: CreditCustomerRow[] = customerRowsAll.slice(0, options.topCustomers ?? DEFAULT_TOP_CUSTOMERS).map(([code, totals], index) => {
    const share = wholeTotals.credit > 0 ? (totals.credit / wholeTotals.credit) * 100 : 0;
    running += share;
    const priorValue = priorCovered ? customerGroups.prior.get(code) ?? 0 : null;
    return {
      rank: index + 1,
      code,
      name: customerNames.get(code) ?? code,
      rep: dominant(customerReps.get(code)),
      ...totals.totals(),
      share,
      cum: running,
      items: totals.items.size,
      principals: totals.principals.size,
      priorCredit: priorValue,
      changePct: changePct(totals.credit, priorValue),
    };
  });
  const top10CustomerShare = wholeTotals.credit > 0 && creditedCustomerCount > 0 ? (customerRowsAll.slice(0, 10).reduce((sum, [, t]) => sum + t.credit, 0) / wholeTotals.credit) * 100 : null;

  // ---- items ----
  const itemGroups = group(inScope, priorLines, (line) => line.itemCode);
  const itemNames = new Map<string, { name: string; principals: Map<string, number> }>();
  for (const line of inScope) {
    let entry = itemNames.get(line.itemCode);
    if (!entry) itemNames.set(line.itemCode, (entry = { name: line.itemName || line.itemCode, principals: new Map() }));
    if (line.doc === "credit") entry.principals.set(line.principal, (entry.principals.get(line.principal) ?? 0) - line.sales);
    else if (!entry.principals.has(line.principal)) entry.principals.set(line.principal, 0);
  }
  const itemRowsAll = Array.from(itemGroups.groups.entries())
    .filter(([, totals]) => totals.creditLines > 0)
    .sort((a, b) => b[1].credit - a[1].credit);
  const itemCount = itemRowsAll.length;
  const itemsCreditedAboveInvoiced = itemRowsAll.filter(([, totals]) => totals.credit > totals.invoiced).length;
  const items: CreditItemRow[] = itemRowsAll.slice(0, options.topItems ?? DEFAULT_TOP_ITEMS).map(([code, totals]) => {
    const priorValue = priorCovered ? itemGroups.prior.get(code) ?? 0 : null;
    return {
      code,
      name: itemNames.get(code)?.name ?? code,
      p: dominant(itemNames.get(code)?.principals),
      ...totals.totals(),
      share: wholeTotals.credit > 0 ? (totals.credit / wholeTotals.credit) * 100 : 0,
      customers: totals.customers.size,
      priorCredit: priorValue,
      changePct: changePct(totals.credit, priorValue),
    };
  });

  // ---- principals ----
  const principalGroups = group(inScope, priorLines, (line) => line.principal);
  const trendEnd = last;
  const months = Array.from(monthsWithLines)
    .filter((month) => month <= trendEnd && month >= shiftMonth(trendEnd, -(TREND_MONTHS - 1)))
    .sort();
  const principalMonthly = new Map<string, Map<string, number>>();
  for (const line of lines) {
    if (line.doc !== "credit" || !months.includes(line.month)) continue;
    let perMonth = principalMonthly.get(line.principal);
    if (!perMonth) principalMonthly.set(line.principal, (perMonth = new Map()));
    perMonth.set(line.month, (perMonth.get(line.month) ?? 0) - line.sales);
  }
  const principals: CreditPrincipalRow[] = Array.from(principalGroups.groups.entries())
    .filter(([, totals]) => totals.creditLines > 0 || totals.invoiced > 0)
    .sort((a, b) => b[1].credit - a[1].credit)
    .map(([p, totals]) => {
      const priorValue = priorCovered ? principalGroups.prior.get(p) ?? 0 : null;
      return {
        p,
        ...totals.totals(),
        share: wholeTotals.credit > 0 ? (totals.credit / wholeTotals.credit) * 100 : 0,
        customers: totals.customers.size,
        items: totals.items.size,
        priorCredit: priorValue,
        changePct: changePct(totals.credit, priorValue),
        m: months.map((month) => principalMonthly.get(p)?.get(month) ?? 0),
      };
    });

  // ---- reps ----
  const repGroups = group(inScope, priorLines, (line) => line.rep);
  const repPrincipals = new Map<string, Map<string, number>>();
  for (const line of inScope) {
    if (line.doc !== "credit") continue;
    let entry = repPrincipals.get(line.rep);
    if (!entry) repPrincipals.set(line.rep, (entry = new Map()));
    entry.set(line.principal, (entry.get(line.principal) ?? 0) - line.sales);
  }
  const reps: CreditRepRow[] = Array.from(repGroups.groups.entries())
    .filter(([, totals]) => totals.creditLines > 0 || totals.invoiced > 0)
    .sort((a, b) => b[1].credit - a[1].credit)
    .map(([n, totals]) => {
      const priorValue = priorCovered ? repGroups.prior.get(n) ?? 0 : null;
      return {
        n: n || "(no rep)",
        ...totals.totals(),
        share: wholeTotals.credit > 0 ? (totals.credit / wholeTotals.credit) * 100 : 0,
        customers: totals.customers.size,
        items: totals.items.size,
        principal: dominant(repPrincipals.get(n)),
        priorCredit: priorValue,
        changePct: changePct(totals.credit, priorValue),
      };
    });

  // ---- warehouses ----
  const warehouseGroups = group(inScope, [], (line) => line.warehouse);
  const warehouses: CreditWarehouseRow[] = Array.from(warehouseGroups.groups.entries())
    .filter(([, totals]) => totals.creditLines > 0 || totals.invoiced > 0)
    .sort((a, b) => b[1].credit - a[1].credit)
    .map(([n, totals]) => ({
      n: n || "(no branch)",
      ...totals.totals(),
      share: wholeTotals.credit > 0 ? (totals.credit / wholeTotals.credit) * 100 : 0,
      customers: totals.customers.size,
    }));

  // ---- month by month ----
  const monthly: CreditMonthRow[] = months.map((month) => {
    const totals = new Totals();
    for (const line of lines) if (line.month === month) totals.add(line);
    const t = totals.totals();
    return { m: month, inScope: scopeSet.has(month), credit: t.credit, invoiced: t.invoiced, cnPct: t.cnPct, cases: t.cases, customers: totals.customers.size, creditLines: t.creditLines };
  });

  // ---- largest individual credit lines ----
  const topLines: CreditLineRow[] = inScope
    .filter((line) => line.doc === "credit" && line.sales < 0)
    .sort((a, b) => a.sales - b.sales)
    .slice(0, options.topLines ?? DEFAULT_TOP_LINES)
    .map((line) => ({
      month: line.month,
      customerCode: line.customerCode,
      customerName: line.customerName,
      itemCode: line.itemCode,
      itemName: line.itemName,
      principal: line.principal,
      rep: line.rep || "(no rep)",
      warehouse: line.warehouse || "(no branch)",
      cases: -line.cases,
      credit: -line.sales,
      gpLost: -line.gp,
    }));

  const kpi: CreditNoteKpi = {
    ...wholeTotals,
    net: wholeTotals.invoiced - wholeTotals.credit,
    customers: whole.customers.size,
    items: whole.items.size,
    reps: whole.reps.size,
    principals: whole.principals.size,
    avgPerCustomer: whole.customers.size > 0 ? wholeTotals.credit / whole.customers.size : null,
    priorCredit,
    creditChangePct: priorCredit !== null ? changePct(wholeTotals.credit, priorCredit) : null,
    priorCnPct: priorCovered ? priorTotals.cnPct : null,
    cnPctChange: priorCovered && wholeTotals.cnPct !== null && priorTotals.cnPct !== null ? wholeTotals.cnPct - priorTotals.cnPct : null,
    top10CustomerShare,
    itemsCreditedAboveInvoiced,
  };

  const payload: CreditNotesPayload = {
    asOf: options.asOf,
    months,
    scope,
    priorScope,
    mtd: options.asOf.slice(0, 7) === last,
    kpi,
    monthly,
    principals,
    items,
    customers,
    reps,
    warehouses,
    topLines,
    itemCount,
    customerCount: creditedCustomerCount,
    insights: [],
  };
  payload.insights = buildInsights(payload);
  return payload;
}

/** A few plain sentences about what stands out; each only appears when the figures support it. */
export function buildInsights(p: CreditNotesPayload): string[] {
  const out: string[] = [];
  const { kpi } = p;
  if (kpi.credit <= 0) return ["No credit notes were issued in this selection."];

  const rate = kpi.cnPct !== null ? `${fmtPct(kpi.cnPct)} of what was invoiced` : "";
  let headline = `Credit notes came to **${fmtKes(kpi.credit)}**${rate ? `, ${rate}` : ""}, across ${kpi.customers.toLocaleString("en-US")} customers and ${kpi.items.toLocaleString("en-US")} items.`;
  if (kpi.creditChangePct !== null && kpi.priorCredit !== null) {
    headline += ` That is ${kpi.creditChangePct >= 0 ? "up" : "down"} ${Math.abs(kpi.creditChangePct).toFixed(1)}% on the ${p.priorScope.length === 1 ? monthName(p.priorScope[0]) : "previous period"} (${fmtKes(kpi.priorCredit)}).`;
  }
  out.push(headline);

  const topPrincipal = p.principals[0];
  if (topPrincipal && topPrincipal.credit > 0 && p.principals.length > 1) {
    out.push(`**${topPrincipal.p}** carries the most credit notes: ${fmtKes(topPrincipal.credit)}, ${fmtPct(topPrincipal.share, 0)} of the total${topPrincipal.cnPct !== null ? `, a rate of ${fmtPct(topPrincipal.cnPct)} of its invoicing` : ""}.`);
  }

  const material = kpi.invoiced * MATERIAL_INVOICED_SHARE;
  const worstPrincipal = p.principals.filter((row) => row.invoiced >= material && row.cnPct !== null).sort((a, b) => (b.cnPct ?? 0) - (a.cnPct ?? 0))[0];
  if (worstPrincipal && worstPrincipal.cnPct !== null && kpi.cnPct !== null && worstPrincipal.cnPct > kpi.cnPct * 1.25 && p.principals.length > 1) {
    out.push(`**${worstPrincipal.p}** has the highest rate, ${fmtPct(worstPrincipal.cnPct)} of its invoicing against ${fmtPct(kpi.cnPct)} overall.`);
  }

  const topCustomer = p.customers[0];
  if (topCustomer) {
    out.push(`The largest credit-note customer is **${topCustomer.name}** (${fmtKes(topCustomer.credit)}, ${fmtPct(topCustomer.share, 0)} of the total)${kpi.top10CustomerShare !== null ? `; the ten largest customers account for ${fmtPct(kpi.top10CustomerShare, 0)}` : ""}.`);
  }

  const topItem = p.items[0];
  if (topItem) out.push(`The most credited item is **${topItem.name}** (${topItem.code}): ${fmtKes(topItem.credit)} across ${topItem.customers.toLocaleString("en-US")} customers.`);

  const worstRep = p.reps.filter((row) => row.invoiced >= material && row.cnPct !== null).sort((a, b) => (b.cnPct ?? 0) - (a.cnPct ?? 0))[0];
  if (worstRep && worstRep.cnPct !== null && kpi.cnPct !== null && worstRep.cnPct > kpi.cnPct * 1.5) {
    out.push(`**${worstRep.n}** has the highest credit-note rate among reps: ${fmtPct(worstRep.cnPct)} of invoicing (${fmtKes(worstRep.credit)}).`);
  }

  if (kpi.itemsCreditedAboveInvoiced > 0) {
    out.push(`${kpi.itemsCreditedAboveInvoiced.toLocaleString("en-US")} item${kpi.itemsCreditedAboveInvoiced === 1 ? " was" : "s were"} credited for more than was invoiced in the period, which usually means returns of earlier sales or a price correction.`);
  }
  return out;
}
