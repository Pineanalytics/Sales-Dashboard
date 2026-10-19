// Strike rate by MONTH, per customer and principal. A year-to-date strike rate blends months together and gives the wrong impression of where the
// field is today, so the analysis works on one calendar month at a time (with a month-by-month trend).
//
// The rules are those of each source's Coverage & Productivity figure (see lib/outletUniverse/strikeRate.ts):
//   - Pine: reps that called the customer in the month, and those of them with a sale or order (CoverageCustomerActual, filled by the Coverage sync);
//   - EABL DMS: the customer-month is called, and productive when any call that month was productive (EablCall);
//   - Upfield DataEdge: the customer-month is called, and productive when a sale above zero was booked (UpfieldTransaction);
//   - Leverage: completed documents only, so calls are the customer-months with a document and there is no productive measure (null).
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

export interface MonthCounts {
  /** Index 0..11 of the calendar month. */
  calls: number[];
  /** null per month where the source cannot tell a productive call. */
  productive: (number | null)[];
}

export interface MonthlyStrike {
  year: number;
  /** Counts per customer: key = source|principal|customerId. */
  byCustomer: Map<string, MonthCounts>;
  /** Counts per principal over all its customers: key = source|principal. */
  byPrincipal: Map<string, MonthCounts>;
  /** Source -> months (0..11) in which it has any call data at all. */
  monthsWithData: Map<string, Set<number>>;
}

export interface StrikeSourceMonthRow {
  source: string;
  principal: string;
  customerId: string;
  monthIndex: number;
  calls: number;
  productive: number | null;
}

export const strikeCustomerKey = (source: string, principal: string, customerId: string) => `${source}\u0000${principal}\u0000${customerId}`;
export const strikePrincipalKey = (source: string, principal: string) => `${source}\u0000${principal}`;

const blank = (): MonthCounts => ({ calls: new Array(12).fill(0), productive: new Array(12).fill(0) });

function add(into: Map<string, MonthCounts>, key: string, row: StrikeSourceMonthRow) {
  const e = into.get(key) ?? blank();
  e.calls[row.monthIndex] += row.calls;
  e.productive[row.monthIndex] = row.productive === null || e.productive[row.monthIndex] === null ? null : (e.productive[row.monthIndex] as number) + row.productive;
  into.set(key, e);
}

export function buildMonthlyStrike(year: number, rows: StrikeSourceMonthRow[]): MonthlyStrike {
  const byCustomer = new Map<string, MonthCounts>();
  const byPrincipal = new Map<string, MonthCounts>();
  const monthsWithData = new Map<string, Set<number>>();
  for (const row of rows) {
    add(byCustomer, strikeCustomerKey(row.source, row.principal, row.customerId), row);
    add(byPrincipal, strikePrincipalKey(row.source, row.principal), row);
    const set = monthsWithData.get(row.source) ?? new Set<number>();
    set.add(row.monthIndex);
    monthsWithData.set(row.source, set);
  }
  return { year, byCustomer, byPrincipal, monthsWithData };
}

export async function loadMonthlyStrike(): Promise<MonthlyStrike> {
  const year = new Date().getFullYear();
  const [pine, eabl, upfield, leverage] = await Promise.all([
    prisma.$queryRaw<{ principal: string; customerId: string; monthIndex: number; calls: number; productive: number }[]>(Prisma.sql`
      SELECT principal, "customerId", "monthIndex", SUM(coverage)::int AS calls, SUM("productiveCalls")::int AS productive
      FROM "CoverageCustomerActual" WHERE year = ${String(year)}
      GROUP BY principal, "customerId", "monthIndex"
    `),
    prisma.$queryRaw<{ principal: string; customerId: string; monthIndex: number; productive: number }[]>(Prisma.sql`
      SELECT ecm.principal, ec."customerCode" AS "customerId", (EXTRACT(MONTH FROM ec."callDate")::int - 1) AS "monthIndex", (BOOL_OR(ec."isProductive"))::int AS productive
      FROM "EablCall" ec INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
      WHERE ec."customerCode" IS NOT NULL AND EXTRACT(YEAR FROM ec."callDate") = ${year}
      GROUP BY ecm.principal, ec."customerCode", "monthIndex"
    `),
    prisma.$queryRaw<{ customerId: string; monthIndex: number; productive: number }[]>(Prisma.sql`
      SELECT "custCode" AS "customerId", (EXTRACT(MONTH FROM "txnDate")::int - 1) AS "monthIndex", (BOOL_OR(type = 'sale' AND COALESCE("saleIncl", 0) > 0))::int AS productive
      FROM "UpfieldTransaction"
      WHERE NULLIF(BTRIM("custCode"), '') IS NOT NULL AND NULLIF(BTRIM(fsr), '') IS NOT NULL AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST' AND EXTRACT(YEAR FROM "txnDate") = ${year}
      GROUP BY "custCode", "monthIndex"
    `),
    prisma.$queryRaw<{ storageLocation: string; customerId: string; monthIndex: number }[]>(Prisma.sql`
      SELECT DISTINCT "storageLocation", "customerCode" AS "customerId", (EXTRACT(MONTH FROM "deliveryDate")::int - 1) AS "monthIndex"
      FROM "SalesReturnLine" WHERE EXTRACT(YEAR FROM "deliveryDate") = ${year}
    `),
  ]);
  const rows: StrikeSourceMonthRow[] = [
    ...pine.map((r) => ({ source: "PINE", principal: r.principal, customerId: r.customerId, monthIndex: r.monthIndex, calls: r.calls, productive: r.productive })),
    ...eabl.map((r) => ({ source: "EABL", principal: r.principal, customerId: r.customerId, monthIndex: r.monthIndex, calls: 1, productive: r.productive })),
    ...upfield.map((r) => ({ source: "UPFIELD", principal: "Upfield-Nairobi", customerId: r.customerId, monthIndex: r.monthIndex, calls: 1, productive: r.productive })),
    ...leverage.map((r) => ({
      source: "LEVERAGE",
      principal: `Unilever-${SALES_RETURNS_BRANCH_LABELS[r.storageLocation] ?? r.storageLocation}`,
      customerId: r.customerId,
      monthIndex: r.monthIndex,
      calls: 1,
      productive: null,
    })),
  ];
  return buildMonthlyStrike(year, rows);
}

/** Calls and productive calls of one customer and principal in month m (calls 0 when it was not called). */
export function monthCounts(data: MonthlyStrike, source: string, principal: string, customerId: string, m: number): { calls: number; productive: number | null } {
  const e = data.byCustomer.get(strikeCustomerKey(source, principal, customerId));
  return e ? { calls: e.calls[m], productive: e.productive[m] } : { calls: 0, productive: source === "LEVERAGE" ? null : 0 };
}

/** The same over the trailing window of `months` months ending at month m. */
export function windowCounts(data: MonthlyStrike, source: string, principal: string, customerId: string, m: number, months: number): { calls: number; productive: number | null } {
  const e = data.byCustomer.get(strikeCustomerKey(source, principal, customerId));
  let calls = 0;
  let productive: number | null = source === "LEVERAGE" ? null : 0;
  if (!e) return { calls, productive };
  for (let i = Math.max(0, m - months + 1); i <= m; i++) {
    calls += e.calls[i];
    if (productive !== null && e.productive[i] !== null) productive += e.productive[i] as number;
  }
  return { calls, productive };
}

/** A principal's strike rate in month m over all its customers (percent to one decimal), or null when it has no calls or no productive measure. */
export function principalMonthStrike(data: MonthlyStrike, source: string, principal: string, m: number): number | null {
  const e = data.byPrincipal.get(strikePrincipalKey(source, principal));
  if (!e || e.calls[m] <= 0 || e.productive[m] === null) return null;
  return Math.round(((e.productive[m] as number) / e.calls[m]) * 1000) / 10;
}
