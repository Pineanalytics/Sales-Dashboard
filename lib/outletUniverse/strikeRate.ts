// Strike rate in the Active Outlets extract, added up from customer level. Same call rules as the Coverage page (scripts/db-bridge/coverage/
// transform.ts): in a month, a customer is "called" for a principal by each rep that visited it and "productive" for each of those reps that sold
// or took an order there. A customer's calls are the sum of those over the year's months, a principal's calls are the sum over its customers, and
// strike rate = productive / calls. Only Pine customers have call data (it comes from the Pine call log); other sources show blank.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface StrikeCounts {
  calls: number;
  productive: number;
}

export interface StrikeData {
  year: string | null;
  /** Calls and productive calls per principal and Pine customer id, summed over the year's months. */
  byCustomer: Map<string, StrikeCounts>;
  /** The same, summed over every customer of the principal. */
  byPrincipal: Map<string, StrikeCounts>;
}

const customerKey = (principal: string, customerId: string) => `${principal}\u0000${customerId}`;

/** productive / calls as a percentage to one decimal; null when there were no calls (nothing to divide by). */
export function strikeRatePct(counts: StrikeCounts | undefined): number | null {
  if (!counts || counts.calls <= 0) return null;
  return Math.round((counts.productive / counts.calls) * 1000) / 10;
}

export function addCounts(a: StrikeCounts | undefined, b: StrikeCounts): StrikeCounts {
  return { calls: (a?.calls ?? 0) + b.calls, productive: (a?.productive ?? 0) + b.productive };
}

export function buildStrikeData(year: string | null, rows: { principal: string; customerId: string; calls: number; productive: number }[]): StrikeData {
  const byCustomer = new Map<string, StrikeCounts>();
  const byPrincipal = new Map<string, StrikeCounts>();
  for (const row of rows) {
    const counts = { calls: row.calls, productive: row.productive };
    byCustomer.set(customerKey(row.principal, row.customerId), addCounts(byCustomer.get(customerKey(row.principal, row.customerId)), counts));
    byPrincipal.set(row.principal, addCounts(byPrincipal.get(row.principal), counts));
  }
  return { year, byCustomer, byPrincipal };
}

/** The latest year with customer calls, summed per principal and customer. Empty until the coverage sync has stored customer rows. */
export async function loadStrikeData(): Promise<StrikeData> {
  const rows = await prisma.$queryRaw<{ year: string; principal: string; customerId: string; calls: number; productive: number }[]>(Prisma.sql`
    SELECT year, principal, "customerId", SUM(coverage)::int AS calls, SUM("productiveCalls")::int AS productive
    FROM "CoverageCustomerActual"
    WHERE year = (SELECT MAX(year) FROM "CoverageCustomerActual")
    GROUP BY year, principal, "customerId"
  `);
  return buildStrikeData(rows[0]?.year ?? null, rows);
}

export interface OutletStrike {
  calls: number | null;
  productive: number | null;
  pct: number | null;
  /** "Mars-Nairobi: 62.5% (5/8); EABL-Nyeri: 40.0% (2/5)" for each of the outlet's principals that has calls. */
  byPrincipal: string | null;
  /** The row's principal's strike rate over all its customers: a number for one principal, "Mars-Nairobi: 58.1%; ..." for several. */
  principalPct: number | string | null;
}

const NO_STRIKE: OutletStrike = { calls: null, productive: null, pct: null, byPrincipal: null, principalPct: null };

function fmt(pct: number | null): string {
  return pct === null ? "n/a" : `${pct.toFixed(1)}%`;
}

/** Strike figures for one extract row. `principals` is the row's principal list ("A, B" in the general view, one name in the principal view). */
export function outletStrike(row: { source: string; outletKey: string; principals: string }, data: StrikeData): OutletStrike {
  if (row.source !== "PINE" || !data.year) return NO_STRIKE;
  const principals = row.principals.split(", ").map((p) => p.trim()).filter(Boolean);
  let total: StrikeCounts | undefined;
  const parts: string[] = [];
  const principalParts: string[] = [];
  for (const principal of principals) {
    const own = data.byCustomer.get(customerKey(principal, row.outletKey));
    if (own) {
      total = addCounts(total, own);
      parts.push(`${principal}: ${fmt(strikeRatePct(own))} (${own.productive}/${own.calls})`);
    }
    const overall = strikeRatePct(data.byPrincipal.get(principal));
    if (overall !== null) principalParts.push(principals.length === 1 ? String(overall) : `${principal}: ${fmt(overall)}`);
  }
  return {
    calls: total ? total.calls : 0,
    productive: total ? total.productive : 0,
    pct: strikeRatePct(total),
    byPrincipal: parts.length > 0 ? parts.join("; ") : null,
    principalPct: principalParts.length === 0 ? null : principals.length === 1 ? Number(principalParts[0]) : principalParts.join("; "),
  };
}
