// The full, untruncated lists behind the Performance Analysis export. The on-screen report shows the top 10 items, the top 25
// customers, the top 20 reps and 15 branches; the Excel export carries every one of them, built from the same stored SAP lines and
// the same period, so a total here always agrees with the page. Pure, no I/O.
import { INTERNAL_ACCOUNT_PATTERN } from "./aggregate";
import type { PerfLine } from "./types";

export interface DetailItem {
  code: string;
  name: string;
  principal: string;
  sales: number;
  gp: number;
  cases: number;
  customers: number;
  /** Net sales per month of the period, aligned to `scope`. */
  m: number[];
}

export interface DetailCustomer {
  code: string;
  name: string;
  internal: boolean;
  sales: number;
  gp: number;
  items: number;
  months: number;
  principals: string;
  /** The rep and branch with the most sales to this account. */
  rep: string;
  warehouse: string;
  m: number[];
}

export interface DetailGroup {
  name: string;
  sales: number;
  gp: number;
  cases: number;
  customers: number;
  principals: string;
  m: number[];
}

export interface PerformanceDetail {
  /** Months of the period the `m` arrays line up with. */
  scope: string[];
  /** Net sales of every in-scope line: the base for share columns. */
  totalSales: number;
  items: DetailItem[];
  customers: DetailCustomer[];
  reps: DetailGroup[];
  warehouses: DetailGroup[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function topKey(weights: Map<string, number>): string {
  let best = "";
  let bestWeight = Number.NEGATIVE_INFINITY;
  for (const [key, weight] of weights) {
    if (weight > bestWeight) {
      best = key;
      bestWeight = weight;
    }
  }
  return best;
}

function add(map: Map<string, number>, key: string, value: number): void {
  map.set(key, (map.get(key) ?? 0) + value);
}

/** Principals a group sold, biggest first: "Mars, EABL". */
function principalList(weights: Map<string, number>): string {
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).join(", ");
}

export function buildPerformanceDetail(lines: PerfLine[], scope: string[]): PerformanceDetail {
  const months = Array.from(new Set(scope)).sort();
  const at = new Map(months.map((month, index) => [month, index]));

  const items = new Map<string, { name: string; principal: string; sales: number; gp: number; cases: number; customers: Set<string>; m: number[] }>();
  const customers = new Map<string, { name: string; sales: number; gp: number; items: Set<string>; months: Set<string>; principals: Map<string, number>; reps: Map<string, number>; warehouses: Map<string, number>; m: number[] }>();
  const reps = new Map<string, { sales: number; gp: number; cases: number; customers: Set<string>; principals: Map<string, number>; m: number[] }>();
  const warehouses = new Map<string, { sales: number; gp: number; cases: number; customers: Set<string>; principals: Map<string, number>; m: number[] }>();
  let totalSales = 0;

  const blank = () => months.map(() => 0);
  for (const line of lines) {
    const index = at.get(line.month);
    if (index === undefined) continue;
    totalSales += line.sales;

    const item = items.get(line.itemCode) ?? items.set(line.itemCode, { name: line.itemName, principal: line.principal, sales: 0, gp: 0, cases: 0, customers: new Set(), m: blank() }).get(line.itemCode)!;
    item.sales += line.sales;
    item.gp += line.gp;
    item.cases += line.cases;
    item.customers.add(line.customerCode);
    item.m[index] += line.sales;

    const customer =
      customers.get(line.customerCode) ??
      customers.set(line.customerCode, { name: line.customerName, sales: 0, gp: 0, items: new Set(), months: new Set(), principals: new Map(), reps: new Map(), warehouses: new Map(), m: blank() }).get(line.customerCode)!;
    customer.sales += line.sales;
    customer.gp += line.gp;
    customer.items.add(line.itemCode);
    customer.months.add(line.month);
    add(customer.principals, line.principal, line.sales);
    add(customer.reps, line.rep || "Unassigned", line.sales);
    add(customer.warehouses, line.warehouse || "Unassigned", line.sales);
    customer.m[index] += line.sales;

    for (const [map, key] of [[reps, line.rep || "Unassigned"], [warehouses, line.warehouse || "Unassigned"]] as const) {
      const group = map.get(key) ?? map.set(key, { sales: 0, gp: 0, cases: 0, customers: new Set(), principals: new Map(), m: blank() }).get(key)!;
      group.sales += line.sales;
      group.gp += line.gp;
      group.cases += line.cases;
      group.customers.add(line.customerCode);
      add(group.principals, line.principal, line.sales);
      group.m[index] += line.sales;
    }
  }

  const bySales = <T extends { sales: number }>(a: T, b: T) => b.sales - a.sales;
  const rounded = (values: number[]) => values.map(round2);
  const groups = (map: typeof reps): DetailGroup[] =>
    [...map.entries()]
      .map(([name, g]) => ({ name, sales: round2(g.sales), gp: round2(g.gp), cases: round2(g.cases), customers: g.customers.size, principals: principalList(g.principals), m: rounded(g.m) }))
      .sort(bySales);

  return {
    scope: months,
    totalSales: round2(totalSales),
    items: [...items.entries()]
      .map(([code, i]) => ({ code, name: i.name, principal: i.principal, sales: round2(i.sales), gp: round2(i.gp), cases: round2(i.cases), customers: i.customers.size, m: rounded(i.m) }))
      .sort(bySales),
    customers: [...customers.entries()]
      .map(([code, c]) => ({
        code,
        name: c.name,
        internal: INTERNAL_ACCOUNT_PATTERN.test(c.name),
        sales: round2(c.sales),
        gp: round2(c.gp),
        items: c.items.size,
        months: c.months.size,
        principals: principalList(c.principals),
        rep: topKey(c.reps),
        warehouse: topKey(c.warehouses),
        m: rounded(c.m),
      }))
      .sort(bySales),
    reps: groups(reps),
    warehouses: groups(warehouses),
  };
}
