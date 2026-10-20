// Strike rate in the Active Outlets extract, added up from customer level. Every source uses the same rules as its own Coverage & Productivity
// figure, so a principal's total in the extract equals the page's:
//   - Pine: in a month a customer is "called" for a principal by each rep that visited it and "productive" for each of those reps with a sale or
//     order (CoverageCustomerActual, filled by the Coverage sync; the Coverage page sums the same counts over reps).
//   - EABL DMS: a customer-month is called when the customer has a call in EablCall and productive when any of that month's calls was productive
//     (getEablMonthlyCoverageRollup counts each customer-month once).
//   - Upfield DataEdge: a customer-month is called when the customer has a transaction row and productive when one is a sale above zero
//     (getUpfieldMonthlyCoverageRollup); a customer with only returns is covered but not productive.
//   - Leverage: the Centegy feed holds completed invoices and returns only, never a call without a sale, so a strike rate cannot be measured
//     (see getLeverageMonthlyCoverageRollup). Calls are the customer-months with a document; productive and strike rate are left blank.
// Deliberately scoped to each source's own most recent month only, not year-to-date: an outlet bought from once early in the year otherwise
// stays "called" (and often "productive") for every month since, which inflates the YTD rate for outlets nobody has actually been visiting
// lately. "Most recent month" is each source's own latest month of data (MAX of its date column), not the wall-clock calendar month, so a
// source that's a few days behind on sync doesn't read as having zero calls. A customer's calls are that one month's count for it, a
// principal's calls are the sum over its customers, and strike rate = productive divided by calls.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";

export interface StrikeCounts {
  calls: number;
  /** null where the source cannot tell a productive call from any other (Leverage). */
  productive: number | null;
}

export interface StrikeData {
  /** Non-null once loadStrikeData has run — a presence flag only, not a meaningful calendar year
   *  (each source below is independently scoped to its own latest month, not this value). */
  year: string | null;
  /** Counts per source, principal and customer id, for each source's most recent month only. */
  byCustomer: Map<string, StrikeCounts>;
  /** The same, summed over every customer of the source's principal. */
  byPrincipal: Map<string, StrikeCounts>;
}

export interface StrikeSourceRow {
  source: string;
  principal: string;
  customerId: string;
  calls: number;
  productive: number | null;
}

const customerKey = (source: string, principal: string, customerId: string) => `${source}\u0000${principal}\u0000${customerId}`;
const principalKey = (source: string, principal: string) => `${source}\u0000${principal}`;

/** productive / calls as a percentage to one decimal; null when there were no calls or the source cannot say which were productive. */
export function strikeRatePct(counts: StrikeCounts | undefined): number | null {
  if (!counts || counts.calls <= 0 || counts.productive === null) return null;
  return Math.round((counts.productive / counts.calls) * 1000) / 10;
}

export function addCounts(a: StrikeCounts | undefined, b: StrikeCounts): StrikeCounts {
  if (!a) return { calls: b.calls, productive: b.productive };
  return { calls: a.calls + b.calls, productive: a.productive === null || b.productive === null ? null : a.productive + b.productive };
}

export function buildStrikeData(year: string | null, rows: StrikeSourceRow[]): StrikeData {
  const byCustomer = new Map<string, StrikeCounts>();
  const byPrincipal = new Map<string, StrikeCounts>();
  for (const row of rows) {
    const counts = { calls: row.calls, productive: row.productive };
    const ck = customerKey(row.source, row.principal, row.customerId);
    byCustomer.set(ck, addCounts(byCustomer.get(ck), counts));
    const pk = principalKey(row.source, row.principal);
    byPrincipal.set(pk, addCounts(byPrincipal.get(pk), counts));
  }
  return { year, byCustomer, byPrincipal };
}

/** The extract's customer calls from the four sources, each scoped to its own most recent month of
 *  data (not year-to-date — see this file's header comment). A source with no data yet simply
 *  contributes nothing. */
export async function loadStrikeData(): Promise<StrikeData> {
  const [pine, eabl, upfield, leverage] = await Promise.all([
    prisma.$queryRaw<{ principal: string; customerId: string; calls: number; productive: number }[]>(Prisma.sql`
      SELECT principal, "customerId", SUM(coverage)::int AS calls, SUM("productiveCalls")::int AS productive
      FROM "CoverageCustomerActual"
      WHERE (year, "monthIndex") = (SELECT year, "monthIndex" FROM "CoverageCustomerActual" ORDER BY year DESC, "monthIndex" DESC LIMIT 1)
      GROUP BY principal, "customerId"
    `),
    prisma.$queryRaw<{ principal: string; customerId: string; calls: number; productive: number }[]>(Prisma.sql`
      SELECT principal, "customerId", COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE productive)::int AS productive
      FROM (
        SELECT ecm.principal, ec."customerCode" AS "customerId", date_trunc('month', ec."callDate") AS m, BOOL_OR(ec."isProductive") AS productive
        FROM "EablCall" ec INNER JOIN "EablCustomerMaster" ecm ON ecm."customerId" = ec."customerCode"
        WHERE ec."customerCode" IS NOT NULL AND date_trunc('month', ec."callDate") = (SELECT date_trunc('month', MAX("callDate")) FROM "EablCall")
        GROUP BY ecm.principal, ec."customerCode", m
      ) months
      GROUP BY principal, "customerId"
    `),
    prisma.$queryRaw<{ customerId: string; calls: number; productive: number }[]>(Prisma.sql`
      SELECT "custCode" AS "customerId", COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE productive)::int AS productive
      FROM (
        SELECT "custCode", date_trunc('month', "txnDate") AS m, BOOL_OR(type = 'sale' AND COALESCE("saleIncl", 0) > 0) AS productive
        FROM "UpfieldTransaction"
        WHERE NULLIF(BTRIM("custCode"), '') IS NOT NULL AND NULLIF(BTRIM(fsr), '') IS NOT NULL AND UPPER(BTRIM(fsr)) <> 'CONNECTIVITY TEST'
          AND date_trunc('month', "txnDate") = (SELECT date_trunc('month', MAX("txnDate")) FROM "UpfieldTransaction")
        GROUP BY "custCode", m
      ) months
      GROUP BY "custCode"
    `),
    prisma.$queryRaw<{ storageLocation: string; customerId: string; calls: number }[]>(Prisma.sql`
      SELECT "storageLocation", "customerCode" AS "customerId", COUNT(*)::int AS calls
      FROM (
        SELECT DISTINCT "customerCode", "storageLocation", date_trunc('month', "deliveryDate") AS m
        FROM "SalesReturnLine" WHERE date_trunc('month', "deliveryDate") = (SELECT date_trunc('month', MAX("deliveryDate")) FROM "SalesReturnLine")
      ) months
      GROUP BY "storageLocation", "customerCode"
    `),
  ]);
  const rows: StrikeSourceRow[] = [
    ...pine.map((r) => ({ source: "PINE", principal: r.principal, customerId: r.customerId, calls: r.calls, productive: r.productive })),
    ...eabl.map((r) => ({ source: "EABL", principal: r.principal, customerId: r.customerId, calls: r.calls, productive: r.productive })),
    ...upfield.map((r) => ({ source: "UPFIELD", principal: "Upfield-Nairobi", customerId: r.customerId, calls: r.calls, productive: r.productive })),
    ...leverage.map((r) => ({
      source: "LEVERAGE",
      principal: `Unilever-${SALES_RETURNS_BRANCH_LABELS[r.storageLocation] ?? r.storageLocation}`,
      customerId: r.customerId,
      calls: r.calls,
      productive: null,
    })),
  ];
  return buildStrikeData(String(new Date().getFullYear()), rows);
}

export interface OutletStrike {
  calls: number | null;
  productive: number | null;
  pct: number | null;
  /** "Mars-Nairobi: 62.5% (5/8); EABL-Nyeri: 40.0% (2/5)" for each of the outlet's principals that has calls (Leverage: "Unilever-Nairobi: 6 calls"). */
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
  if (!data.year) return NO_STRIKE;
  const principals = row.principals.split(", ").map((p) => p.trim()).filter(Boolean);
  let total: StrikeCounts | undefined;
  const parts: string[] = [];
  const principalParts: string[] = [];
  for (const principal of principals) {
    const own = data.byCustomer.get(customerKey(row.source, principal, row.outletKey));
    if (own) {
      total = addCounts(total, own);
      parts.push(own.productive === null ? `${principal}: ${own.calls} calls` : `${principal}: ${fmt(strikeRatePct(own))} (${own.productive}/${own.calls})`);
    }
    const overall = strikeRatePct(data.byPrincipal.get(principalKey(row.source, principal)));
    if (overall !== null) principalParts.push(principals.length === 1 ? String(overall) : `${principal}: ${fmt(overall)}`);
  }
  // A source with no call data at all (nothing loaded for this outlet's source and principals) stays blank rather than showing zero.
  const sourceHasData = principals.some((principal) => data.byPrincipal.has(principalKey(row.source, principal)));
  if (!sourceHasData) return NO_STRIKE;
  return {
    calls: total ? total.calls : 0,
    productive: total ? total.productive : 0,
    pct: strikeRatePct(total),
    byPrincipal: parts.length > 0 ? parts.join("; ") : null,
    principalPct: principalParts.length === 0 ? null : principals.length === 1 ? Number(principalParts[0]) : principalParts.join("; "),
  };
}
