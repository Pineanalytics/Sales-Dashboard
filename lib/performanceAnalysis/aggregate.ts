// Aggregates SAP sales lines into the Performance Analysis payload for ONE selected
// period (and whatever principals the lines were filtered to). A TypeScript port of
// the standalone build_dashboard.py report: same definitions and thresholds, but the
// report is cut to the viewer's period rather than fixed to the whole year.
//
//  - Totals, rankings and shares are over the months of the selected period (`scope`).
//  - Trend charts and the monthly tables span every month from the first month with
//    data to the end of the period, so a single month still shows its context.
//  - Growth compares a window of the period with the equal-length window before it
//    (see comparisonWindows). The earlier window may lie before the period starts.
//
// Pure: no I/O.
import type {
  AbcRow,
  BridgeRow,
  Concentration,
  CustomerRow,
  GpBasis,
  ItemRow,
  MonthlyRow,
  MovementRow,
  PerfLine,
  PerformancePayload,
  PrincipalRow,
  RepRow,
  WarehouseRow,
} from "./types";

/** Accounts treated as internal selling points (route vans, counters, cash accounts) rather than end customers. */
export const INTERNAL_ACCOUNT_PATTERN = /\bVAN\b|COUNTER|CASH CUSTOMER|^EABL|^UDV|WAREHOUSE|ROUTE/i;

/** Growth % is hidden when its comparison base is too small to mean anything. */
const MIN_PRINCIPAL_BASE = 1e5;
const MIN_MONTH_BASE = 5e4;
const MIN_ITEM_BASE = 5e4;

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PARETO_POINTS = [1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const round = (value: number, places = 0): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const growth = (current: number, base: number, places = 1): number | null => (base > 0 ? round((current / base - 1) * 100, places) : null);
const monthAbbrev = (month: string): string => MONTH_ABBREV[Number(month.slice(5, 7)) - 1] ?? month;

/** "2026-09" shifted by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Every month from `from` to `to` inclusive. */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from; month <= to; month = addMonths(month, 1)) months.push(month);
  return months;
}

const monthEndDate = (month: string): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);

function windowLabel(months: string[]): string | null {
  if (months.length === 0) return null;
  const startIndex = Number(months[0].slice(5, 7)) - 1;
  if (months.length === 3 && startIndex % 3 === 0) return `Q${startIndex / 3 + 1}`;
  if (months.length === 1) return monthAbbrev(months[0]);
  return `${monthAbbrev(months[0])}–${monthAbbrev(months[months.length - 1])}`;
}

/** The two windows growth compares. For a period longer than a quarter it is the latest complete calendar
 *  quarter inside the period against the quarter before it; for a shorter period it is the period's full
 *  months against the same number of months before them. Empty when the earlier window has no data. */
export function comparisonWindows(scope: string[], mtd: boolean, hasData: (month: string) => boolean): { current: string[]; prior: string[] } {
  const full = mtd ? scope.slice(0, -1) : scope;
  let current: string[] = [];
  if (scope.length > 3) {
    const perQuarter = new Map<string, string[]>();
    for (const month of full) {
      const key = `${month.slice(0, 4)}-${Math.floor((Number(month.slice(5, 7)) - 1) / 3)}`;
      perQuarter.set(key, [...(perQuarter.get(key) ?? []), month]);
    }
    const complete = Array.from(perQuarter.entries()).filter(([, months]) => months.length === 3).sort(([a], [b]) => (a < b ? -1 : 1));
    current = complete.length > 0 ? complete[complete.length - 1][1] : [];
  } else {
    current = full;
  }
  if (current.length === 0) return { current: [], prior: [] };
  const prior = monthRange(addMonths(current[0], -current.length), addMonths(current[0], -1));
  if (!prior.every(hasData)) return { current: [], prior: [] };
  return { current, prior };
}

function mode(counts: Map<string, number>): string {
  let best = "";
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

interface MonthAcc {
  sales: number;
  gp: number;
  cases: number;
  inv: number;
  cn: number;
  trade: number;
  customers: Set<string>;
  items: Set<string>;
}

interface PrincipalAcc {
  m: number[];
  g: number[];
  scoped: boolean;
  inv: number;
  cn: number;
  customers: Set<string>;
  items: Set<string>;
}

interface ItemAcc {
  name: string;
  principal: string;
  m: number[];
  scoped: boolean;
  gp: number;
  cases: number;
  customers: Set<string>;
}

interface CustomerAcc {
  name: string;
  internal: boolean;
  m: number[];
  scoped: boolean;
  gp: number;
  items: Set<string>;
  months: Set<string>;
  principals: Set<string>;
  reps: Map<string, number>;
  warehouses: Map<string, number>;
  tradeMonth: Map<string, number>;
}

interface GroupAcc {
  m: number[];
  scoped: boolean;
  gp: number;
  customers: Set<string>;
  principals: Map<string, number>;
}

export interface AggregateOptions {
  basis: GpBasis;
  /** Nairobi calendar date of the read, YYYY-MM-DD. Decides whether the last month of the period is complete. */
  asOf: string;
  /** The months of the selected period (YYYY-MM). Defaults to every month that has lines. */
  scopeMonths?: string[];
}

function emptyPayload(options: AggregateOptions, scope: string[]): PerformancePayload {
  return {
    basis: options.basis,
    asOf: options.asOf,
    months: [],
    scope,
    mtd: false,
    labels: { cq: null, pq: null, cm: null, pm: null },
    kpi: {
      sales: 0,
      gp: 0,
      gpm: null,
      gross: 0,
      cn: 0,
      cnPct: null,
      cqSales: null,
      pqSales: null,
      cqSalesGrowth: null,
      cqGp: null,
      pqGp: null,
      cqGpGrowth: null,
      cmSales: null,
      pmSales: null,
      cmGrowth: null,
      customers: 0,
      skus: 0,
      avgMonth: null,
      mtdSales: 0,
      lines: 0,
    },
    monthly: [],
    principals: [],
    top10: [],
    top10gp: [],
    gainers: [],
    decliners: [],
    belowCost: [],
    top10Share: 0,
    sku80: 0,
    skuActive: 0,
    topCustomers: [],
    topTrade: [],
    concentration: { top10: 0, top20: 0, top50: 0, c80: 0, active: 0, tTop10: 0, tTop20: 0, t80: 0, tActive: 0, internalShare: 0, internalCount: 0 },
    abc: [],
    pareto: [],
    movement: [],
    warehouses: [],
    reps: [],
    repCount: 0,
    bridge: [],
  };
}

export function aggregatePerformance(allLines: PerfLine[], options: AggregateOptions): PerformancePayload {
  const gpOf = options.basis === "recorded" ? (line: PerfLine) => line.gpRecorded : (line: PerfLine) => line.gp;
  const dataMonths = new Set<string>();
  for (const line of allLines) dataMonths.add(line.month);
  const sortedData = Array.from(dataMonths).sort();
  const scope = options.scopeMonths ? Array.from(new Set(options.scopeMonths)).sort() : sortedData;
  if (scope.length === 0 || sortedData.length === 0) return emptyPayload(options, scope);

  // ---- The period, the months it is shown against, and its comparison windows --------------
  const end = scope[scope.length - 1];
  const first = sortedData[0] < scope[0] ? sortedData[0] : scope[0];
  const months = monthRange(first, end);
  const monthIndex = new Map(months.map((month, index) => [month, index]));
  const scopeSet = new Set(scope);
  const scopeIdx = scope.map((month) => monthIndex.get(month)!);
  const mtd = options.asOf < monthEndDate(end);
  const fullScope = mtd ? scope.slice(0, -1) : scope;

  const windows = comparisonWindows(scope, mtd, (month) => dataMonths.has(month));
  const curIdx = windows.current.map((month) => monthIndex.get(month)!);
  const priIdx = windows.prior.map((month) => monthIndex.get(month)!);
  const hasWindows = curIdx.length > 0 && priIdx.length > 0;
  const cm = fullScope.length > 0 ? fullScope[fullScope.length - 1] : null;
  const pmCandidate = cm ? addMonths(cm, -1) : null;
  const pm = pmCandidate && dataMonths.has(pmCandidate) ? pmCandidate : null;
  const cmI = cm ? monthIndex.get(cm)! : null;
  const pmI = pm ? monthIndex.get(pm)! : null;
  const labels = {
    cq: hasWindows ? windowLabel(windows.current) : null,
    pq: hasWindows ? windowLabel(windows.prior) : null,
    cm: cm ? monthAbbrev(cm) : null,
    pm: pm ? monthAbbrev(pm) : null,
  };

  const T = months.length;
  const zeros = () => new Array<number>(T).fill(0);
  const sumAt = (values: number[], indexes: number[]) => indexes.reduce((sum, index) => sum + values[index], 0);

  // ---- One pass over the lines up to the end of the period -----------------------------------
  const byMonth = new Map<string, MonthAcc>();
  const byPrincipal = new Map<string, PrincipalAcc>();
  const byItem = new Map<string, ItemAcc>();
  const byCustomer = new Map<string, CustomerAcc>();
  const byWarehouse = new Map<string, GroupAcc>();
  const byRep = new Map<string, GroupAcc>();
  const scopeCustomers = new Set<string>();
  const scopeItems = new Set<string>();
  let scopeLines = 0;
  let totalSales = 0;
  let totalGp = 0;
  let invoiced = 0;
  let credited = 0;

  const group = (map: Map<string, GroupAcc>, key: string): GroupAcc => {
    let acc = map.get(key);
    if (!acc) {
      acc = { m: zeros(), scoped: false, gp: 0, customers: new Set(), principals: new Map() };
      map.set(key, acc);
    }
    return acc;
  };

  for (const line of allLines) {
    const mi = monthIndex.get(line.month);
    if (mi === undefined) continue; // after the end of the period
    const inScope = scopeSet.has(line.month);
    const gp = gpOf(line);
    const internal = INTERNAL_ACCOUNT_PATTERN.test(line.customerName);

    let month = byMonth.get(line.month);
    if (!month) {
      month = { sales: 0, gp: 0, cases: 0, inv: 0, cn: 0, trade: 0, customers: new Set(), items: new Set() };
      byMonth.set(line.month, month);
    }
    month.sales += line.sales;
    month.gp += gp;
    month.cases += line.cases;
    if (line.doc === "invoice") month.inv += line.sales;
    else month.cn += line.sales;
    if (!internal) month.trade += line.sales;
    month.customers.add(line.customerCode);
    month.items.add(line.itemCode);

    let principal = byPrincipal.get(line.principal);
    if (!principal) {
      principal = { m: zeros(), g: zeros(), scoped: false, inv: 0, cn: 0, customers: new Set(), items: new Set() };
      byPrincipal.set(line.principal, principal);
    }
    principal.m[mi] += line.sales;
    principal.g[mi] += gp;

    let item = byItem.get(line.itemCode);
    if (!item) {
      item = { name: line.itemName, principal: line.principal, m: zeros(), scoped: false, gp: 0, cases: 0, customers: new Set() };
      byItem.set(line.itemCode, item);
    }
    item.m[mi] += line.sales;

    let customer = byCustomer.get(line.customerCode);
    if (!customer) {
      customer = { name: line.customerName, internal, m: zeros(), scoped: false, gp: 0, items: new Set(), months: new Set(), principals: new Set(), reps: new Map(), warehouses: new Map(), tradeMonth: new Map() };
      byCustomer.set(line.customerCode, customer);
    }
    customer.internal ||= internal;
    customer.m[mi] += line.sales;
    if (!internal) customer.tradeMonth.set(line.month, (customer.tradeMonth.get(line.month) ?? 0) + line.sales);

    const warehouse = group(byWarehouse, line.warehouse);
    warehouse.m[mi] += line.sales;
    const rep = group(byRep, line.rep);
    rep.m[mi] += line.sales;

    if (!inScope) continue;

    // Scope-only measures
    scopeLines += 1;
    totalSales += line.sales;
    totalGp += gp;
    if (line.doc === "invoice") invoiced += line.sales;
    else credited += line.sales;
    scopeCustomers.add(line.customerCode);
    scopeItems.add(line.itemCode);

    principal.scoped = true;
    if (line.doc === "invoice") principal.inv += line.sales;
    else principal.cn += line.sales;
    principal.customers.add(line.customerCode);
    principal.items.add(line.itemCode);

    item.scoped = true;
    item.gp += gp;
    item.cases += line.cases;
    item.customers.add(line.customerCode);

    customer.scoped = true;
    customer.gp += gp;
    customer.items.add(line.itemCode);
    customer.months.add(line.month);
    customer.principals.add(line.principal);
    bump(customer.reps, line.rep);
    bump(customer.warehouses, line.warehouse);

    warehouse.scoped = true;
    warehouse.gp += gp;
    warehouse.customers.add(line.customerCode);
    rep.scoped = true;
    rep.gp += gp;
    rep.customers.add(line.customerCode);
    bump(rep.principals, line.principal);
  }

  const monthSales = months.map((month) => byMonth.get(month)?.sales ?? 0);
  const monthGp = months.map((month) => byMonth.get(month)?.gp ?? 0);

  // ---- KPIs ----------------------------------------------------------------------------------
  const cqSales = hasWindows ? sumAt(monthSales, curIdx) : null;
  const pqSales = hasWindows ? sumAt(monthSales, priIdx) : null;
  const cqGp = hasWindows ? sumAt(monthGp, curIdx) : null;
  const pqGp = hasWindows ? sumAt(monthGp, priIdx) : null;
  const cmSales = cmI === null ? null : monthSales[cmI];
  const pmSales = pmI === null ? null : monthSales[pmI];
  const kpi = {
    sales: round(totalSales),
    gp: round(totalGp),
    gpm: totalSales !== 0 ? round((totalGp / totalSales) * 100, 2) : null,
    gross: round(invoiced),
    cn: round(credited),
    cnPct: invoiced > 0 ? round((-credited / invoiced) * 100, 1) : null,
    cqSales: cqSales === null ? null : round(cqSales),
    pqSales: pqSales === null ? null : round(pqSales),
    cqSalesGrowth: cqSales !== null && pqSales !== null ? growth(cqSales, pqSales) : null,
    cqGp: cqGp === null ? null : round(cqGp),
    pqGp: pqGp === null ? null : round(pqGp),
    cqGpGrowth: cqGp !== null && pqGp !== null ? growth(cqGp, pqGp) : null,
    cmSales: cmSales === null ? null : round(cmSales),
    pmSales: pmSales === null ? null : round(pmSales),
    cmGrowth: cmSales !== null && pmSales !== null ? growth(cmSales, pmSales) : null,
    customers: scopeCustomers.size,
    skus: scopeItems.size,
    avgMonth: fullScope.length > 0 ? round(fullScope.reduce((sum, month) => sum + monthSales[monthIndex.get(month)!], 0) / fullScope.length) : null,
    mtdSales: mtd ? round(monthSales[monthIndex.get(end)!]) : 0,
    lines: scopeLines,
  };

  // ---- Monthly scorecard (every month shown, the period's months flagged) ----------------------
  const monthly: MonthlyRow[] = months.map((month, index) => {
    const acc = byMonth.get(month);
    const sales = acc?.sales ?? 0;
    const gp = acc?.gp ?? 0;
    const prior = index > 0 ? byMonth.get(months[index - 1]) : undefined;
    const isMtd = mtd && month === end;
    return {
      m: month,
      inScope: scopeSet.has(month),
      sales: round(sales, 2),
      gp: round(gp, 2),
      cust: acc?.customers.size ?? 0,
      sku: acc?.items.size ?? 0,
      cases: round(acc?.cases ?? 0, 2),
      inv: round(acc?.inv ?? 0, 2),
      cn: round(acc?.cn ?? 0, 2),
      trade: round(acc?.trade ?? 0, 2),
      gpm: sales !== 0 ? round((gp / sales) * 100, 2) : null,
      cnPct: acc && acc.inv > 0 ? round((-acc.cn / acc.inv) * 100, 2) : null,
      mom: !isMtd && prior && prior.sales !== 0 ? round((sales / prior.sales - 1) * 100, 2) : null,
      gpMom: !isMtd && prior && prior.gp !== 0 ? round((gp / prior.gp - 1) * 100, 2) : null,
      dropSize: acc && acc.customers.size > 0 ? round(sales / acc.customers.size, 2) : null,
    };
  });

  // ---- Principals ----------------------------------------------------------------------------
  const principals: PrincipalRow[] = Array.from(byPrincipal.entries())
    .map(([name, acc]) => ({ name, acc, sales: sumAt(acc.m, scopeIdx), gp: sumAt(acc.g, scopeIdx), pqS: hasWindows ? sumAt(acc.m, priIdx) : null, cqS: hasWindows ? sumAt(acc.m, curIdx) : null }))
    .filter(({ acc, pqS, cqS }) => acc.scoped || (pqS ?? 0) !== 0 || (cqS ?? 0) !== 0)
    .sort((a, b) => b.sales - a.sales || (b.cqS ?? 0) - (a.cqS ?? 0))
    .map(({ name, acc, sales, gp, pqS, cqS }) => {
      const pqG = hasWindows ? sumAt(acc.g, priIdx) : null;
      const cqG = hasWindows ? sumAt(acc.g, curIdx) : null;
      const smallBase = pqS === null || pqS < MIN_PRINCIPAL_BASE;
      const cmS = cmI === null ? null : acc.m[cmI];
      const pmS = pmI === null ? null : acc.m[pmI];
      const monthBaseOk = cmS !== null && pmS !== null && cmS >= MIN_MONTH_BASE && pmS >= MIN_MONTH_BASE;
      return {
        p: name,
        sales: round(sales),
        gp: round(gp),
        gpm: sales !== 0 ? round((gp / sales) * 100, 2) : null,
        share: totalSales !== 0 ? round((sales / totalSales) * 100, 2) : 0,
        m: acc.m.map((value) => round(value)),
        g: acc.g.map((value) => round(value)),
        pqSales: round(pqS ?? 0),
        cqSales: round(cqS ?? 0),
        cqGrowth: !smallBase && cqS !== null && pqS !== null ? growth(cqS, pqS) : null,
        cqGpGrowth: !smallBase && cqG !== null && pqG !== null ? growth(cqG, pqG) : null,
        pqGpm: pqS && pqG !== null ? round((pqG / pqS) * 100, 2) : null,
        cqGpm: cqS && cqG !== null ? round((cqG / cqS) * 100, 2) : null,
        cmGrowth: monthBaseOk && cmS !== null && pmS !== null ? growth(cmS, pmS) : null,
        cnPct: acc.inv > 0 ? round((-acc.cn / acc.inv) * 100, 1) : null,
        skus: acc.items.size,
        cust: acc.customers.size,
      };
    });

  // ---- Items ---------------------------------------------------------------------------------
  const toItemRow = (code: string, acc: ItemAcc): ItemRow => {
    const sales = sumAt(acc.m, scopeIdx);
    const pqS = hasWindows ? sumAt(acc.m, priIdx) : null;
    const cqS = hasWindows ? sumAt(acc.m, curIdx) : null;
    return {
      code,
      name: acc.name,
      p: acc.principal,
      sales: round(sales),
      gp: round(acc.gp),
      gpm: sales !== 0 ? round((acc.gp / sales) * 100, 2) : null,
      cases: round(acc.cases),
      cust: acc.customers.size,
      share: totalSales !== 0 ? round((sales / totalSales) * 100, 2) : 0,
      pqSales: round(pqS ?? 0),
      cqSales: round(cqS ?? 0),
      cqGrowth: pqS !== null && cqS !== null && pqS >= MIN_ITEM_BASE ? growth(cqS, pqS) : null,
      delta: round((cqS ?? 0) - (pqS ?? 0)),
      m: acc.m.map((value) => round(value)),
    };
  };
  const allItemRows = Array.from(byItem.entries()).map(([code, acc]) => ({ acc, row: toItemRow(code, acc) }));
  const scopedItems = allItemRows.filter(({ acc }) => acc.scoped).map(({ row }) => row);
  const bySales = [...scopedItems].sort((a, b) => b.sales - a.sales);
  const top10 = bySales.slice(0, 10);
  const top10gp = [...scopedItems].sort((a, b) => b.gp - a.gp).slice(0, 10);
  const moved = hasWindows ? allItemRows.map(({ row }) => row).filter((row) => row.cqSales !== 0 || row.pqSales !== 0) : [];
  const gainers = [...moved].sort((a, b) => b.delta - a.delta).slice(0, 10);
  const decliners = [...moved].sort((a, b) => a.delta - b.delta).slice(0, 10);
  const belowCost = scopedItems
    .filter((row) => row.sales > 0 && row.gp < 0)
    .sort((a, b) => a.gp - b.gp)
    .slice(0, 10);
  const itemSalesTotal = bySales.reduce((sum, row) => sum + Math.max(row.sales, 0), 0);
  let running = 0;
  let sku80 = 0;
  for (const row of bySales) {
    if (row.sales <= 0) break;
    sku80 += 1;
    running += row.sales;
    if (itemSalesTotal > 0 && running / itemSalesTotal >= 0.8) break;
  }
  const skuActive = bySales.filter((row) => row.sales > 0).length;
  const top10Share = totalSales !== 0 ? round((top10.reduce((sum, row) => sum + row.sales, 0) / totalSales) * 100, 1) : 0;

  // ---- Customers -----------------------------------------------------------------------------
  const scopedCustomers = Array.from(byCustomer.entries())
    .filter(([, acc]) => acc.scoped)
    .map(([code, acc]) => ({ code, acc, sales: sumAt(acc.m, scopeIdx) }))
    .sort((a, b) => b.sales - a.sales);
  const customerSalesTotal = scopedCustomers.reduce((sum, entry) => sum + entry.sales, 0);
  const tradeEntries = scopedCustomers.filter((entry) => !entry.acc.internal);
  const tradeSalesTotal = tradeEntries.reduce((sum, entry) => sum + entry.sales, 0);

  const toCustomerRow = (entry: (typeof scopedCustomers)[number], rank: number, shareBase: number, cum: number): CustomerRow => {
    const { acc, code, sales } = entry;
    const pqS = hasWindows ? sumAt(acc.m, priIdx) : null;
    const cqS = hasWindows ? sumAt(acc.m, curIdx) : null;
    return {
      rank,
      code,
      name: acc.name,
      internal: acc.internal,
      sales: round(sales),
      gp: round(acc.gp),
      gpm: sales !== 0 ? round((acc.gp / sales) * 100, 2) : null,
      share: shareBase !== 0 ? round((sales / shareBase) * 100, 2) : 0,
      cum: round(cum, 1),
      items: acc.items.size,
      months: acc.months.size,
      princ: acc.principals.size,
      pqSales: round(pqS ?? 0),
      cqSales: round(cqS ?? 0),
      cqGrowth: pqS !== null && cqS !== null && pqS >= MIN_ITEM_BASE ? growth(cqS, pqS) : null,
      rep: mode(acc.reps),
      wh: mode(acc.warehouses),
    };
  };

  const allCum: number[] = [];
  let cumulative = 0;
  for (const entry of scopedCustomers) {
    cumulative += customerSalesTotal !== 0 ? (entry.sales / customerSalesTotal) * 100 : 0;
    allCum.push(cumulative);
  }
  const tradeCum: number[] = [];
  cumulative = 0;
  for (const entry of tradeEntries) {
    cumulative += tradeSalesTotal !== 0 ? (entry.sales / tradeSalesTotal) * 100 : 0;
    tradeCum.push(cumulative);
  }

  const topCustomers = scopedCustomers.slice(0, 25).map((entry, i) => toCustomerRow(entry, i + 1, customerSalesTotal, allCum[i]));
  const topTrade = tradeEntries.slice(0, 25).map((entry, i) => toCustomerRow(entry, i + 1, tradeSalesTotal, tradeCum[i]));

  const countTo80 = (entries: typeof scopedCustomers, cum: number[]) => {
    let n = 0;
    entries.forEach((entry, i) => {
      if (entry.sales > 0 && cum[i] < 80) n += 1;
    });
    return n + 1;
  };
  const sumShare = (entries: typeof scopedCustomers, count: number, base: number) => (base !== 0 ? round((entries.slice(0, count).reduce((sum, entry) => sum + entry.sales, 0) / base) * 100, 1) : 0);
  const internalEntries = scopedCustomers.filter((entry) => entry.acc.internal);
  const concentration: Concentration = {
    top10: sumShare(scopedCustomers, 10, customerSalesTotal),
    top20: sumShare(scopedCustomers, 20, customerSalesTotal),
    top50: sumShare(scopedCustomers, 50, customerSalesTotal),
    c80: countTo80(scopedCustomers, allCum),
    active: scopedCustomers.filter((entry) => entry.sales > 0).length,
    tTop10: sumShare(tradeEntries, 10, tradeSalesTotal),
    tTop20: sumShare(tradeEntries, 20, tradeSalesTotal),
    t80: countTo80(tradeEntries, tradeCum),
    tActive: tradeEntries.filter((entry) => entry.sales > 0).length,
    internalShare: customerSalesTotal !== 0 ? round((internalEntries.reduce((sum, entry) => sum + entry.sales, 0) / customerSalesTotal) * 100, 1) : 0,
    internalCount: internalEntries.length,
  };

  const tradePositive = tradeEntries.map((entry, i) => ({ entry, cum: tradeCum[i] })).filter(({ entry }) => entry.sales > 0);
  const abcTotal = tradePositive.reduce((sum, { entry }) => sum + entry.sales, 0);
  const abc: AbcRow[] = (["A", "B", "C"] as const)
    .map((cls) => {
      const members = tradePositive.filter(({ cum }) => (cum <= 80 ? "A" : cum <= 95 ? "B" : "C") === cls);
      const sales = members.reduce((sum, { entry }) => sum + entry.sales, 0);
      const gp = members.reduce((sum, { entry }) => sum + entry.acc.gp, 0);
      return { cls, n: members.length, sales: round(sales), share: abcTotal !== 0 ? round((sales / abcTotal) * 100, 1) : 0, gpm: sales !== 0 ? round((gp / sales) * 100, 2) : null };
    })
    .filter((row) => row.n > 0);
  const pareto =
    tradePositive.length === 0
      ? []
      : PARETO_POINTS.map((x) => {
          const n = Math.max(1, Math.floor((tradePositive.length * x) / 100));
          return { x, y: round(tradePositive[n - 1].cum, 1) };
        });

  // Trade customers buying each month: retained / reactivated / new / lapsed, over every month shown
  const activeByMonth = months.map((month) => {
    const set = new Set<string>();
    for (const [code, acc] of byCustomer) if ((acc.tradeMonth.get(month) ?? 0) > 0) set.add(code);
    return set;
  });
  const seen = new Set<string>();
  const movement: MovementRow[] = months.map((month, index) => {
    const current = activeByMonth[index];
    const previous = index > 0 ? activeByMonth[index - 1] : new Set<string>();
    let retained = 0;
    let reactivated = 0;
    let fresh = 0;
    for (const code of current) {
      if (previous.has(code)) retained += 1;
      else if (seen.has(code)) reactivated += 1;
      else fresh += 1;
    }
    let lost = 0;
    if (index > 0) for (const code of previous) if (!current.has(code)) lost += 1;
    for (const code of current) seen.add(code);
    return { m: month, active: current.size, retained, reactivated, new: fresh, lost };
  });

  // ---- Warehouses and reps -----------------------------------------------------------------------
  const windowGrowth = (acc: GroupAcc): number | null => {
    if (!hasWindows) return null;
    return growth(sumAt(acc.m, curIdx), sumAt(acc.m, priIdx));
  };
  const warehouses: WarehouseRow[] = Array.from(byWarehouse.entries())
    .filter(([, acc]) => acc.scoped)
    .map(([name, acc]) => ({ name, acc, sales: sumAt(acc.m, scopeIdx) }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 15)
    .map(({ name, acc, sales }) => ({
      n: name,
      sales: round(sales),
      gp: round(acc.gp),
      gpm: sales !== 0 ? round((acc.gp / sales) * 100, 2) : null,
      cust: acc.customers.size,
      share: totalSales !== 0 ? round((sales / totalSales) * 100, 2) : 0,
      cqGrowth: windowGrowth(acc),
    }));
  const scopedReps = Array.from(byRep.entries())
    .filter(([, acc]) => acc.scoped)
    .map(([name, acc]) => ({ name, acc, sales: sumAt(acc.m, scopeIdx) }))
    .sort((a, b) => b.sales - a.sales);
  const reps: RepRow[] = scopedReps.slice(0, 20).map(({ name, acc, sales }) => ({
    n: name,
    sales: round(sales),
    gp: round(acc.gp),
    gpm: sales !== 0 ? round((acc.gp / sales) * 100, 2) : null,
    cust: acc.customers.size,
    princ: Array.from(acc.principals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([principal]) => principal)
      .join(", "),
    share: totalSales !== 0 ? round((sales / totalSales) * 100, 2) : 0,
    cqGrowth: windowGrowth(acc),
  }));

  const bridge: BridgeRow[] = hasWindows
    ? principals.map((row) => {
        const acc = byPrincipal.get(row.p)!;
        return { p: row.p, ds: round(row.cqSales - row.pqSales), dg: round(sumAt(acc.g, curIdx) - sumAt(acc.g, priIdx)) };
      })
    : [];

  return {
    basis: options.basis,
    asOf: options.asOf,
    months,
    scope,
    mtd,
    labels,
    kpi,
    monthly,
    principals,
    top10,
    top10gp,
    gainers,
    decliners,
    belowCost,
    top10Share,
    sku80,
    skuActive,
    topCustomers,
    topTrade,
    concentration,
    abc,
    pareto,
    movement,
    warehouses,
    reps,
    repCount: scopedReps.length,
    bridge,
  };
}
