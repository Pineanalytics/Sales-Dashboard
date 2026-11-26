// Rep sales as the Coaching app shows them to a rep and their team leader, worked out here from the same rows the app receives
// (lib/universeFeed.ts: one row per outlet x principal, plus its monthly sales and calls). The rules are the app's, so the two agree:
//   buying           the outlet is Active
//   bought           sales in the chosen month above zero
//   not visited      no call in the month and no sale
//   visited, no sale at least one call in the month and no sale
//   strike rate      productive calls / calls, only over rows that record productive calls (Leverage records none: never 0%)
// Pure, so it is tested without a database.
import type { UniverseFeedRow, UniverseHistoryRow } from "@/lib/universeFeed";

export type VisitStatus = "Bought" | "Visited, no sale" | "Not visited";

export interface RepOutletSales {
  teamLeader: string;
  rep: string;
  repCode: string;
  principal: string;
  outletId: string;
  outlet: string;
  territory: string;
  status: string;
  tier: string;
  lastPurchase: string | null;
  daysSincePurchase: number | null;
  salesThisMonth: number;
  salesLastMonth: number;
  salesTwoMonthsAgo: number;
  salesYtd: number;
  transactions: number;
  calls: number;
  productiveCalls: number | null;
  visit: VisitStatus;
}

export interface RepSalesSummary {
  teamLeader: string;
  rep: string;
  repCode: string;
  principals: string;
  outlets: number;
  buyingOutlets: number;
  boughtThisMonth: number;
  salesThisMonth: number;
  salesLastMonth: number;
  salesTwoMonthsAgo: number;
  salesYtd: number;
  transactions: number;
  outletsVisited: number;
  visitedNoSale: number;
  notVisited: number;
  calls: number;
  productiveCalls: number | null;
  strikeRatePct: number | null;
}

export interface RepSalesFilters {
  /** "2026-11" */
  month: string;
  /** Team leader names the viewer may see; null = everyone. */
  leaders: string[] | null;
  teamLeader?: string;
  principal?: string;
  repCode?: string;
  /** Part of a rep's name or code. */
  search?: string;
}

export interface RepSalesReport {
  month: string;
  reps: RepSalesSummary[];
  outlets: RepOutletSales[];
  /** For the filters: what the viewer may see, before the team leader, principal and rep filters. */
  teamLeaders: string[];
  principals: string[];
}

const fold = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const money = (n: number) => Math.round(n * 100) / 100;

/** The month `back` months before "YYYY-MM". */
export function monthBefore(month: string, back: number): string {
  const [year, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const keyOf = (row: { sourceCode: string; outletId: string; principal: string }) => `${row.sourceCode}\u0000${row.outletId}\u0000${row.principal}`;

export function buildRepSales(universe: UniverseFeedRow[], history: UniverseHistoryRow[], filters: RepSalesFilters): RepSalesReport {
  const allowed = filters.leaders === null ? null : new Set(filters.leaders.map(fold));
  const visible = universe.filter((row) => !!row.repSfaId?.trim() && (allowed === null || allowed.has(fold(row.teamLeader))));
  const teamLeaders = [...new Set(visible.map((r) => (r.teamLeader ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const principals = [...new Set(visible.map((r) => r.principal).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  const search = fold(filters.search);
  const chosen = visible.filter(
    (row) =>
      (!filters.teamLeader || fold(row.teamLeader) === fold(filters.teamLeader)) &&
      (!filters.principal || row.principal === filters.principal) &&
      (!filters.repCode || fold(row.repSfaId) === fold(filters.repCode)) &&
      (!search || fold(row.rep).includes(search) || fold(row.repSfaId).includes(search)),
  );

  const months = new Map(history.map((row) => [keyOf(row), row.months]));
  const [m0, m1, m2] = [filters.month, monthBefore(filters.month, 1), monthBefore(filters.month, 2)];

  const outlets: RepOutletSales[] = chosen.map((row) => {
    const byMonth = months.get(keyOf(row));
    const now = byMonth?.[m0];
    const sales = now?.sales ?? 0;
    const calls = now?.calls ?? 0;
    // A row whose system records no productive calls stays unknown, even in a month with no activity.
    const productive = row.sourceCode === "LEVERAGE" ? null : (now?.productive ?? 0);
    return {
      teamLeader: (row.teamLeader ?? "").trim() || "No team leader",
      rep: (row.rep ?? "").trim() || "Unnamed rep",
      repCode: (row.repSfaId as string).trim(),
      principal: row.principal,
      outletId: row.outletId,
      outlet: row.outlet,
      territory: row.territoryClean || row.territory || "",
      status: row.status,
      tier: row.tier,
      lastPurchase: row.lastPurchase,
      daysSincePurchase: row.daysSincePurchase,
      salesThisMonth: sales,
      salesLastMonth: byMonth?.[m1]?.sales ?? 0,
      salesTwoMonthsAgo: byMonth?.[m2]?.sales ?? 0,
      salesYtd: row.salesYtd,
      transactions: now?.transactions ?? 0,
      calls,
      productiveCalls: productive,
      visit: sales > 0 ? "Bought" : calls > 0 ? "Visited, no sale" : "Not visited",
    };
  });

  interface Bucket {
    summary: RepSalesSummary;
    principals: Set<string>;
    leaders: Map<string, number>;
    strikeCalls: number;
    strikeProductive: number;
    tracked: boolean;
  }
  const buckets = new Map<string, Bucket>();
  for (const o of outlets) {
    const key = fold(o.repCode);
    let b = buckets.get(key);
    if (!b) {
      b = {
        summary: {
          teamLeader: o.teamLeader, rep: o.rep, repCode: o.repCode, principals: "", outlets: 0, buyingOutlets: 0, boughtThisMonth: 0,
          salesThisMonth: 0, salesLastMonth: 0, salesTwoMonthsAgo: 0, salesYtd: 0, transactions: 0, outletsVisited: 0, visitedNoSale: 0,
          notVisited: 0, calls: 0, productiveCalls: null, strikeRatePct: null,
        },
        principals: new Set(), leaders: new Map(), strikeCalls: 0, strikeProductive: 0, tracked: false,
      };
      buckets.set(key, b);
    }
    const s = b.summary;
    b.principals.add(o.principal);
    b.leaders.set(o.teamLeader, (b.leaders.get(o.teamLeader) ?? 0) + 1);
    s.outlets++;
    if (o.status.toLowerCase() === "active") s.buyingOutlets++;
    if (o.salesThisMonth > 0) s.boughtThisMonth++;
    s.salesThisMonth += o.salesThisMonth;
    s.salesLastMonth += o.salesLastMonth;
    s.salesTwoMonthsAgo += o.salesTwoMonthsAgo;
    s.salesYtd += o.salesYtd;
    s.transactions += o.transactions;
    s.calls += o.calls;
    if (o.calls > 0) s.outletsVisited++;
    if (o.visit === "Visited, no sale") s.visitedNoSale++;
    if (o.visit === "Not visited") s.notVisited++;
    if (o.productiveCalls !== null) {
      b.tracked = true;
      b.strikeCalls += o.calls;
      b.strikeProductive += o.productiveCalls;
    }
  }

  const reps = [...buckets.values()]
    .map((b) => ({
      ...b.summary,
      // A rep under several team leaders is listed under the one with most of the rep's outlets.
      teamLeader: [...b.leaders.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0],
      principals: [...b.principals].sort((x, y) => x.localeCompare(y)).join(", "),
      salesThisMonth: money(b.summary.salesThisMonth),
      salesLastMonth: money(b.summary.salesLastMonth),
      salesTwoMonthsAgo: money(b.summary.salesTwoMonthsAgo),
      salesYtd: money(b.summary.salesYtd),
      productiveCalls: b.tracked ? b.strikeProductive : null,
      strikeRatePct: b.tracked && b.strikeCalls > 0 ? Math.round((b.strikeProductive / b.strikeCalls) * 1000) / 10 : null,
    }))
    .sort((a, b) => a.teamLeader.localeCompare(b.teamLeader) || b.salesThisMonth - a.salesThisMonth || a.rep.localeCompare(b.rep));

  outlets.sort((a, b) => a.teamLeader.localeCompare(b.teamLeader) || a.rep.localeCompare(b.rep) || b.salesYtd - a.salesYtd || a.outlet.localeCompare(b.outlet));

  return { month: filters.month, reps, outlets, teamLeaders, principals };
}
