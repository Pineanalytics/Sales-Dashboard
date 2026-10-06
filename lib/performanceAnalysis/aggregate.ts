// Aggregates SAP sales lines into the Performance Analysis payload. A TypeScript
// port of the standalone build_dashboard.py report (same definitions, same
// thresholds), so the page and that report agree line for line. Pure: no I/O.
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
const MIN_PRINCIPAL_QUARTER_BASE = 1e5;
const MIN_MONTH_BASE = 5e4;
const MIN_ITEM_QUARTER_BASE = 5e4;

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PARETO_POINTS = [1, 2, 5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const round = (value: number, places = 0): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};
const growth = (current: number, base: number, places = 1): number | null => (base > 0 ? round((current / base - 1) * 100, places) : null);
const monthAbbrev = (month: string): string => MONTH_ABBREV[Number(month.slice(5, 7)) - 1] ?? month;
const quarterOf = (month: string): number => Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1;

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
  q: number[];
  qg: number[];
  inv: number;
  cn: number;
  customers: Set<string>;
  items: Set<string>;
}

interface ItemAcc {
  name: string;
  principal: string;
  sales: number;
  gp: number;
  cases: number;
  customers: Set<string>;
  m: number[];
  q: number[];
}

interface CustomerAcc {
  name: string;
  internal: boolean;
  sales: number;
  gp: number;
  items: Set<string>;
  months: Set<string>;
  principals: Set<string>;
  reps: Map<string, number>;
  warehouses: Map<string, number>;
  q: number[];
  tradeMonth: Map<string, number>;
}

interface GroupAcc {
  sales: number;
  gp: number;
  customers: Set<string>;
  q: number[];
  principals: Map<string, number>;
}

export interface AggregateOptions {
  basis: GpBasis;
  /** Nairobi calendar date of the read, YYYY-MM-DD. Decides whether the last month is complete. */
  asOf: string;
}

const emptyQuarters = (): number[] => [0, 0, 0, 0];

export function aggregatePerformance(lines: PerfLine[], options: AggregateOptions): PerformancePayload {
  const gpOf = options.basis === "recorded" ? (line: PerfLine) => line.gpRecorded : (line: PerfLine) => line.gp;
  const months = Array.from(new Set(lines.map((line) => line.month))).sort();
  const monthIndex = new Map(months.map((month, index) => [month, index]));

  // ---- Comparison periods, detected from the data ----------------------------
  const lastMonth = months[months.length - 1];
  const lastMonthEnd = lastMonth ? new Date(Date.UTC(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0)).toISOString().slice(0, 10) : null;
  const mtd = lastMonth !== undefined && lastMonthEnd !== null && options.asOf < lastMonthEnd;
  const fullMonths = mtd ? months.slice(0, -1) : months;
  const cm = fullMonths[fullMonths.length - 1] ?? null;
  const pm = fullMonths[fullMonths.length - 2] ?? null;
  const fullQuarterCounts = new Map<number, number>();
  for (const month of fullMonths) fullQuarterCounts.set(quarterOf(month), (fullQuarterCounts.get(quarterOf(month)) ?? 0) + 1);
  const completeQuarters = Array.from(fullQuarterCounts.entries())
    .filter(([, count]) => count === 3)
    .map(([quarter]) => quarter);
  const cq = completeQuarters.length > 0 ? Math.max(...completeQuarters) : null;
  const pq = cq !== null && cq > 1 ? cq - 1 : null;
  const qSlot = (quarter: number | null) => (quarter === null ? null : quarter - 1);

  const labels = {
    cq: cq !== null ? `Q${cq}` : null,
    pq: pq !== null ? `Q${pq}` : null,
    cm: cm ? monthAbbrev(cm) : null,
    pm: pm ? monthAbbrev(pm) : null,
  };

  // ---- One pass over the lines -----------------------------------------------
  const byMonth = new Map<string, MonthAcc>();
  const byPrincipal = new Map<string, PrincipalAcc>();
  const byItem = new Map<string, ItemAcc>();
  const byCustomer = new Map<string, CustomerAcc>();
  const byWarehouse = new Map<string, GroupAcc>();
  const byRep = new Map<string, GroupAcc>();
  const allCustomers = new Set<string>();
  const allItems = new Set<string>();
  const quarterSales = emptyQuarters();
  const quarterGp = emptyQuarters();
  let totalSales = 0;
  let totalGp = 0;
  let invoiced = 0;
  let credited = 0;

  const group = (map: Map<string, GroupAcc>, key: string): GroupAcc => {
    let acc = map.get(key);
    if (!acc) {
      acc = { sales: 0, gp: 0, customers: new Set(), q: emptyQuarters(), principals: new Map() };
      map.set(key, acc);
    }
    return acc;
  };

  for (const line of lines) {
    const gp = gpOf(line);
    const mi = monthIndex.get(line.month)!;
    const q = quarterOf(line.month) - 1;
    const internal = INTERNAL_ACCOUNT_PATTERN.test(line.customerName);

    totalSales += line.sales;
    totalGp += gp;
    if (line.doc === "invoice") invoiced += line.sales;
    else credited += line.sales;
    quarterSales[q] += line.sales;
    quarterGp[q] += gp;
    allCustomers.add(line.customerCode);
    allItems.add(line.itemCode);

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
      principal = { m: months.map(() => 0), g: months.map(() => 0), q: emptyQuarters(), qg: emptyQuarters(), inv: 0, cn: 0, customers: new Set(), items: new Set() };
      byPrincipal.set(line.principal, principal);
    }
    principal.m[mi] += line.sales;
    principal.g[mi] += gp;
    principal.q[q] += line.sales;
    principal.qg[q] += gp;
    if (line.doc === "invoice") principal.inv += line.sales;
    else principal.cn += line.sales;
    principal.customers.add(line.customerCode);
    principal.items.add(line.itemCode);

    let item = byItem.get(line.itemCode);
    if (!item) {
      item = { name: line.itemName, principal: line.principal, sales: 0, gp: 0, cases: 0, customers: new Set(), m: months.map(() => 0), q: emptyQuarters() };
      byItem.set(line.itemCode, item);
    }
    item.sales += line.sales;
    item.gp += gp;
    item.cases += line.cases;
    item.customers.add(line.customerCode);
    item.m[mi] += line.sales;
    item.q[q] += line.sales;

    let customer = byCustomer.get(line.customerCode);
    if (!customer) {
      customer = {
        name: line.customerName,
        internal,
        sales: 0,
        gp: 0,
        items: new Set(),
        months: new Set(),
        principals: new Set(),
        reps: new Map(),
        warehouses: new Map(),
        q: emptyQuarters(),
        tradeMonth: new Map(),
      };
      byCustomer.set(line.customerCode, customer);
    }
    customer.internal ||= internal;
    customer.sales += line.sales;
    customer.gp += gp;
    customer.items.add(line.itemCode);
    customer.months.add(line.month);
    customer.principals.add(line.principal);
    bump(customer.reps, line.rep);
    bump(customer.warehouses, line.warehouse);
    customer.q[q] += line.sales;
    if (!internal) customer.tradeMonth.set(line.month, (customer.tradeMonth.get(line.month) ?? 0) + line.sales);

    const warehouse = group(byWarehouse, line.warehouse);
    warehouse.sales += line.sales;
    warehouse.gp += gp;
    warehouse.customers.add(line.customerCode);
    warehouse.q[q] += line.sales;

    const rep = group(byRep, line.rep);
    rep.sales += line.sales;
    rep.gp += gp;
    rep.customers.add(line.customerCode);
    rep.q[q] += line.sales;
    bump(rep.principals, line.principal);
  }

  const cqSlot = qSlot(cq);
  const pqSlot = qSlot(pq);
  const qOf = (values: number[], slot: number | null) => (slot === null ? null : values[slot]);
  const fullCount = fullMonths.length;
  const monthSales = (month: string | null) => (month ? (byMonth.get(month)?.sales ?? 0) : null);

  // ---- KPIs ----------------------------------------------------------------
  const cqSales = qOf(quarterSales, cqSlot);
  const pqSales = qOf(quarterSales, pqSlot);
  const cqGp = qOf(quarterGp, cqSlot);
  const pqGp = qOf(quarterGp, pqSlot);
  const cmSales = monthSales(cm);
  const pmSales = monthSales(pm);
  const mtdSales = mtd && lastMonth ? (byMonth.get(lastMonth)?.sales ?? 0) : 0;
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
    customers: allCustomers.size,
    skus: allItems.size,
    avgMonth: fullCount > 0 ? round(fullMonths.reduce((sum, month) => sum + (byMonth.get(month)?.sales ?? 0), 0) / fullCount) : null,
    mtdSales: round(mtdSales),
    lines: lines.length,
  };

  // ---- Monthly scorecard -----------------------------------------------------
  const monthly: MonthlyRow[] = months.map((month, index) => {
    const acc = byMonth.get(month)!;
    const prior = index > 0 ? byMonth.get(months[index - 1]) : undefined;
    const isMtd = mtd && index === months.length - 1;
    return {
      m: month,
      sales: round(acc.sales, 2),
      gp: round(acc.gp, 2),
      cust: acc.customers.size,
      sku: acc.items.size,
      cases: round(acc.cases, 2),
      inv: round(acc.inv, 2),
      cn: round(acc.cn, 2),
      trade: round(acc.trade, 2),
      gpm: acc.sales !== 0 ? round((acc.gp / acc.sales) * 100, 2) : null,
      cnPct: acc.inv > 0 ? round((-acc.cn / acc.inv) * 100, 2) : null,
      mom: !isMtd && prior && prior.sales !== 0 ? round((acc.sales / prior.sales - 1) * 100, 2) : null,
      gpMom: !isMtd && prior && prior.gp !== 0 ? round((acc.gp / prior.gp - 1) * 100, 2) : null,
      dropSize: acc.customers.size > 0 ? round(acc.sales / acc.customers.size, 2) : null,
    };
  });

  // ---- Principals ------------------------------------------------------------
  const cmIndex = cm ? monthIndex.get(cm)! : null;
  const pmIndex = pm ? monthIndex.get(pm)! : null;
  const principals: PrincipalRow[] = Array.from(byPrincipal.entries())
    .map(([name, acc]) => ({ name, acc, sales: acc.m.reduce((a, b) => a + b, 0), gp: acc.g.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.sales - a.sales)
    .map(({ name, acc, sales, gp }) => {
      const pqS = qOf(acc.q, pqSlot);
      const cqS = qOf(acc.q, cqSlot);
      const pqG = qOf(acc.qg, pqSlot);
      const cqG = qOf(acc.qg, cqSlot);
      const smallBase = pqS === null || pqS < MIN_PRINCIPAL_QUARTER_BASE;
      const cmS = cmIndex === null ? null : acc.m[cmIndex];
      const pmS = pmIndex === null ? null : acc.m[pmIndex];
      const monthBaseOk = cmS !== null && pmS !== null && cmS >= MIN_MONTH_BASE && pmS >= MIN_MONTH_BASE;
      return {
        p: name,
        sales: round(sales),
        gp: round(gp),
        gpm: sales !== 0 ? round((gp / sales) * 100, 2) : null,
        share: totalSales !== 0 ? round((sales / totalSales) * 100, 2) : 0,
        m: acc.m.map((value) => round(value)),
        g: acc.g.map((value) => round(value)),
        q1: round(acc.q[0]),
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

  // ---- Items -----------------------------------------------------------------
  const itemRows = Array.from(byItem.entries()).map(([code, acc]) => {
    const pqS = qOf(acc.q, pqSlot);
    const cqS = qOf(acc.q, cqSlot);
    const row: ItemRow = {
      code,
      name: acc.name,
      p: acc.principal,
      sales: round(acc.sales),
      gp: round(acc.gp),
      gpm: acc.sales !== 0 ? round((acc.gp / acc.sales) * 100, 2) : null,
      cases: round(acc.cases),
      cust: acc.customers.size,
      share: totalSales !== 0 ? round((acc.sales / totalSales) * 100, 2) : 0,
      pqSales: round(pqS ?? 0),
      cqSales: round(cqS ?? 0),
      cqGrowth: pqS !== null && cqS !== null && pqS >= MIN_ITEM_QUARTER_BASE ? growth(cqS, pqS) : null,
      delta: round((cqS ?? 0) - (pqS ?? 0)),
      m: acc.m.map((value) => round(value)),
    };
    return row;
  });
  const bySales = [...itemRows].sort((a, b) => b.sales - a.sales);
  const top10 = bySales.slice(0, 10);
  const top10gp = [...itemRows].sort((a, b) => b.gp - a.gp).slice(0, 10);
  const gainers = pq === null || cq === null ? [] : [...itemRows].sort((a, b) => b.delta - a.delta).slice(0, 10);
  const decliners = pq === null || cq === null ? [] : [...itemRows].sort((a, b) => a.delta - b.delta).slice(0, 10);
  const belowCost = itemRows
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

  // ---- Customers -------------------------------------------------------------
  const customerEntries = Array.from(byCustomer.entries()).sort((a, b) => b[1].sales - a[1].sales);
  const customerSalesTotal = customerEntries.reduce((sum, [, acc]) => sum + acc.sales, 0);
  const tradeEntries = customerEntries.filter(([, acc]) => !acc.internal);
  const tradeSalesTotal = tradeEntries.reduce((sum, [, acc]) => sum + acc.sales, 0);

  const toCustomerRow = (code: string, acc: CustomerAcc, rank: number, shareBase: number, cum: number): CustomerRow => {
    const pqS = qOf(acc.q, pqSlot);
    const cqS = qOf(acc.q, cqSlot);
    return {
      rank,
      code,
      name: acc.name,
      internal: acc.internal,
      sales: round(acc.sales),
      gp: round(acc.gp),
      gpm: acc.sales !== 0 ? round((acc.gp / acc.sales) * 100, 2) : null,
      share: shareBase !== 0 ? round((acc.sales / shareBase) * 100, 2) : 0,
      cum: round(cum, 1),
      items: acc.items.size,
      months: acc.months.size,
      princ: acc.principals.size,
      pqSales: round(pqS ?? 0),
      cqSales: round(cqS ?? 0),
      cqGrowth: pqS !== null && cqS !== null && pqS >= MIN_ITEM_QUARTER_BASE ? growth(cqS, pqS) : null,
      rep: mode(acc.reps),
      wh: mode(acc.warehouses),
    };
  };

  // cumulative share over every account / every trade account, both ranked by sales
  const allCum: number[] = [];
  let cumulative = 0;
  for (const [, acc] of customerEntries) {
    cumulative += customerSalesTotal !== 0 ? (acc.sales / customerSalesTotal) * 100 : 0;
    allCum.push(cumulative);
  }
  const tradeCum: number[] = [];
  cumulative = 0;
  for (const [, acc] of tradeEntries) {
    cumulative += tradeSalesTotal !== 0 ? (acc.sales / tradeSalesTotal) * 100 : 0;
    tradeCum.push(cumulative);
  }

  const topCustomers = customerEntries.slice(0, 25).map(([code, acc], i) => toCustomerRow(code, acc, i + 1, customerSalesTotal, allCum[i]));
  const topTrade = tradeEntries.slice(0, 25).map(([code, acc], i) => toCustomerRow(code, acc, i + 1, tradeSalesTotal, tradeCum[i]));

  const positiveCount = (entries: [string, CustomerAcc][], cum: number[]) => {
    let n = 0;
    entries.forEach(([, acc], i) => {
      if (acc.sales > 0 && cum[i] < 80) n += 1;
    });
    return n + 1;
  };
  const sumShare = (entries: [string, CustomerAcc][], count: number, base: number) =>
    base !== 0 ? round((entries.slice(0, count).reduce((sum, [, acc]) => sum + acc.sales, 0) / base) * 100, 1) : 0;
  const internalEntries = customerEntries.filter(([, acc]) => acc.internal);
  const concentration: Concentration = {
    top10: sumShare(customerEntries, 10, customerSalesTotal),
    top20: sumShare(customerEntries, 20, customerSalesTotal),
    top50: sumShare(customerEntries, 50, customerSalesTotal),
    c80: positiveCount(customerEntries, allCum),
    active: customerEntries.filter(([, acc]) => acc.sales > 0).length,
    tTop10: sumShare(tradeEntries, 10, tradeSalesTotal),
    tTop20: sumShare(tradeEntries, 20, tradeSalesTotal),
    t80: positiveCount(tradeEntries, tradeCum),
    tActive: tradeEntries.filter(([, acc]) => acc.sales > 0).length,
    internalShare: customerSalesTotal !== 0 ? round((internalEntries.reduce((sum, [, acc]) => sum + acc.sales, 0) / customerSalesTotal) * 100, 1) : 0,
    internalCount: internalEntries.length,
  };

  // ABC on trade customers that bought something
  const tradePositive = tradeEntries.map(([, acc], i) => ({ acc, cum: tradeCum[i] })).filter(({ acc }) => acc.sales > 0);
  const abcTotal = tradePositive.reduce((sum, { acc }) => sum + acc.sales, 0);
  const abc: AbcRow[] = (["A", "B", "C"] as const)
    .map((cls) => {
      const members = tradePositive.filter(({ cum }) => (cum <= 80 ? "A" : cum <= 95 ? "B" : "C") === cls);
      const sales = members.reduce((sum, { acc }) => sum + acc.sales, 0);
      const gp = members.reduce((sum, { acc }) => sum + acc.gp, 0);
      return { cls, n: members.length, sales: round(sales), share: abcTotal !== 0 ? round((sales / abcTotal) * 100, 1) : 0, gpm: sales !== 0 ? round((gp / sales) * 100, 2) : null };
    })
    .filter((row) => row.n > 0);
  const pareto = tradePositive.length === 0 ? [] : PARETO_POINTS.map((x) => {
    const n = Math.max(1, Math.floor((tradePositive.length * x) / 100));
    return { x, y: round(tradePositive[n - 1].cum, 1) };
  });

  // Trade customers buying each month: retained / reactivated / new / lapsed
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

  // ---- Warehouses and reps -----------------------------------------------------
  const warehouses: WarehouseRow[] = Array.from(byWarehouse.entries())
    .sort((a, b) => b[1].sales - a[1].sales)
    .slice(0, 15)
    .map(([name, acc]) => {
      const pqS = qOf(acc.q, pqSlot);
      const cqS = qOf(acc.q, cqSlot);
      return {
        n: name,
        sales: round(acc.sales),
        gp: round(acc.gp),
        gpm: acc.sales !== 0 ? round((acc.gp / acc.sales) * 100, 2) : null,
        cust: acc.customers.size,
        share: totalSales !== 0 ? round((acc.sales / totalSales) * 100, 2) : 0,
        cqGrowth: pqS !== null && cqS !== null ? growth(cqS, pqS) : null,
      };
    });
  const reps: RepRow[] = Array.from(byRep.entries())
    .sort((a, b) => b[1].sales - a[1].sales)
    .slice(0, 20)
    .map(([name, acc]) => {
      const pqS = qOf(acc.q, pqSlot);
      const cqS = qOf(acc.q, cqSlot);
      const topPrincipals = Array.from(acc.principals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([principal]) => principal)
        .join(", ");
      return {
        n: name,
        sales: round(acc.sales),
        gp: round(acc.gp),
        gpm: acc.sales !== 0 ? round((acc.gp / acc.sales) * 100, 2) : null,
        cust: acc.customers.size,
        princ: topPrincipals,
        share: totalSales !== 0 ? round((acc.sales / totalSales) * 100, 2) : 0,
        cqGrowth: pqS !== null && cqS !== null ? growth(cqS, pqS) : null,
      };
    });

  const bridge: BridgeRow[] = pq === null || cq === null ? [] : principals.map((row) => {
    const acc = byPrincipal.get(row.p)!;
    return { p: row.p, ds: round(row.cqSales - row.pqSales), dg: round(acc.qg[cqSlot!] - acc.qg[pqSlot!]) };
  });

  return {
    basis: options.basis,
    asOf: options.asOf,
    months,
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
    repCount: byRep.size,
    bridge,
  };
}
