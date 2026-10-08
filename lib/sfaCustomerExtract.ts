// The Customer extract at SFA-outlet level: the customer is the outlet the SFA app sold to (SAP U_CustomerName), with
// the SAP billing account (CardName) shown beside it. Built from SfaCustomerActual rows (month x principal x billing
// account x outlet x rep), the same rows the Customer analysis page ranks, so the figures match the screen.
// Pure, no I/O. Sheet shapes follow lib/brandCustomerExtract.ts.
import type { BrandCustomerExtract, ExtractCell, ExtractScope, ExtractSheet } from "./brandCustomerExtract";
import { summarizeCustomerPortfolio } from "./customerPortfolio";
import { monthKey, sfaOutletKey, sfaOutletRowsToPortfolioRows, type SfaOutletRow } from "./sfaPortfolio";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_REPS_LISTED = 10;
const MAX_OUTLETS_LISTED = 8;
const SEP = "\u0001";

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const share = (part: number, whole: number): ExtractCell => (whole > 0 ? r1((part / whole) * 100) : "");
const marginOf = (grossProfit: number, revenue: number): ExtractCell => (revenue > 0 ? r1((grossProfit / revenue) * 100) : "");
const periodOf = (row: SfaOutletRow) => monthKey(row.year, row.monthIndex);
const periodLabelOf = (period: string) => `${MONTH_NAMES[Number(period.slice(5, 7)) - 1] ?? period.slice(5, 7)} ${period.slice(0, 4)}`;
const outletOf = (row: SfaOutletRow) => row.sfaCustomer.replace(/\s+/g, " ").trim() || "(Unknown Customer)";
const accountOf = (row: SfaOutletRow) => row.accountName.replace(/\s+/g, " ").trim() || row.cardCode;

interface Acc {
  cases: number;
  revenue: number;
  grossProfit: number;
  docs: number;
  reps: Map<string, number>;
  principals: Set<string>;
  accounts: Set<string>;
  outlets: Set<string>;
  periods: Set<string>;
  contacts: Map<string, number>;
  name: string;
}

interface Group {
  parts: string[];
  acc: Acc;
}

function groupRows(rows: SfaOutletRow[], keyOf: (row: SfaOutletRow) => string[], names: Map<string, string>): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const parts = keyOf(row);
    const key = parts.join(SEP);
    let group = groups.get(key);
    if (!group) {
      group = {
        parts,
        acc: { cases: 0, revenue: 0, grossProfit: 0, docs: 0, reps: new Map(), principals: new Set(), accounts: new Set(), outlets: new Set(), periods: new Set(), contacts: new Map(), name: names.get(sfaOutletKey(row.sfaCustomer)) ?? outletOf(row) },
      };
      groups.set(key, group);
    }
    const acc = group.acc;
    acc.cases += row.cases;
    acc.revenue += row.revenue;
    acc.grossProfit += row.grossProfit;
    acc.docs += row.docCount;
    acc.reps.set(row.repName || "Unassigned", (acc.reps.get(row.repName || "Unassigned") ?? 0) + row.revenue);
    acc.principals.add(row.principal);
    acc.accounts.add(accountOf(row));
    acc.outlets.add(sfaOutletKey(row.sfaCustomer));
    acc.periods.add(periodOf(row));
    if (row.sfaContact) acc.contacts.set(row.sfaContact, (acc.contacts.get(row.sfaContact) ?? 0) + Math.abs(row.revenue));
  }
  return groups;
}

const byRevenueDesc = (a: Group, b: Group) => b.acc.revenue - a.acc.revenue;

function repsWhoSold(reps: Map<string, number>): string {
  const total = [...reps.values()].reduce((s, v) => s + v, 0);
  const sorted = [...reps.entries()].sort((a, b) => b[1] - a[1]);
  const listed = sorted.slice(0, MAX_REPS_LISTED).map(([name, revenue]) => (total > 0 ? `${name} (${r1((revenue / total) * 100)}%)` : name));
  const more = sorted.length - MAX_REPS_LISTED;
  return more > 0 ? `${listed.join(", ")} +${more} more` : listed.join(", ");
}

const topContact = (contacts: Map<string, number>) => [...contacts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
const joinSorted = (values: Set<string>) => [...values].sort().join(", ");

/** One spelling per outlet across every sheet: the first one seen, whitespace collapsed. */
function outletNames(rows: SfaOutletRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const key = sfaOutletKey(row.sfaCustomer);
    if (!names.has(key)) names.set(key, outletOf(row));
  }
  return names;
}

export function buildSfaCustomerExtract(input: { currentRows: SfaOutletRow[]; priorYearRows: SfaOutletRow[] | null }, scope: ExtractScope): BrandCustomerExtract {
  const { currentRows, priorYearRows } = input;
  const priorAvailable = priorYearRows !== null;
  const names = outletNames(currentRows);
  const totalRevenue = currentRows.reduce((s, r) => s + r.revenue, 0);

  // Tier, contribution, cumulative share and prior-year figures are the page's own: same function, same rows.
  const portfolio = summarizeCustomerPortfolio({
    currentRows: sfaOutletRowsToPortfolioRows(currentRows),
    latestMonthRows: [],
    previousMonthRows: [],
    priorYearRows: priorAvailable ? sfaOutletRowsToPortfolioRows(priorYearRows) : [],
    customerKey: sfaOutletKey,
  });
  const perOutlet = groupRows(currentRows, (r) => [sfaOutletKey(r.sfaCustomer)], names);

  const rank = new Map<string, number>();
  const rankingRows = portfolio.customers.map((c) => {
    const key = sfaOutletKey(c.customerName);
    rank.set(key, c.rank);
    const acc = perOutlet.get(key)?.acc;
    const periods = acc ? [...acc.periods].sort() : [];
    const accounts = acc ? [...acc.accounts].sort() : [];
    const sameAsAccount = accounts.length > 0 && accounts.every((account) => sfaOutletKey(account) === key);
    return [
      c.rank, acc?.name ?? c.customerName, acc ? topContact(acc.contacts) : "", accounts.join(", "), sameAsAccount ? "Account (SFA name blank)" : "SFA",
      c.tier, c.principals.join(", "), acc ? repsWhoSold(acc.reps) : "", acc?.reps.size ?? 0, periods.length,
      periods.length > 0 ? periodLabelOf(periods[0]) : "", periods.length > 0 ? periodLabelOf(periods[periods.length - 1]) : "", acc?.docs ?? 0,
      r2(c.cases), r2(c.revenue), r2(c.grossProfit), c.grossMarginPct === null ? "" : r1(c.grossMarginPct),
      c.contributionPct === null ? "" : r1(c.contributionPct), c.cumulativeContributionPct === null ? "" : r1(c.cumulativeContributionPct),
      periods.length > 0 ? r2(c.revenue / periods.length) : "",
      priorAvailable ? r2(c.priorYearRevenue) : "", priorAvailable && c.yoyGrowthPct !== null ? r1(c.yoyGrowthPct) : "",
    ];
  });
  const rankOf = (outletKey: string) => rank.get(outletKey) ?? Number.MAX_SAFE_INTEGER;

  const monthTotals = new Map<string, number>();
  for (const r of currentRows) monthTotals.set(periodOf(r), (monthTotals.get(periodOf(r)) ?? 0) + r.revenue);
  const monthly = [...groupRows(currentRows, (r) => [periodOf(r), sfaOutletKey(r.sfaCustomer)], names).values()];
  monthly.sort((a, b) => a.parts[0].localeCompare(b.parts[0]) || byRevenueDesc(a, b));
  const monthlyRows = monthly.map((g) => {
    const [period] = g.parts;
    const { cases, revenue, grossProfit, reps, principals, accounts, docs, name } = g.acc;
    return [
      MONTH_NAMES[Number(period.slice(5, 7)) - 1], Number(period.slice(0, 4)), period, name, joinSorted(accounts), joinSorted(principals), reps.size, repsWhoSold(reps),
      docs, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, monthTotals.get(period) ?? 0),
    ];
  });

  const outletRevenue = new Map([...perOutlet.entries()].map(([key, g]) => [key, g.acc.revenue]));
  const principalRevenue = new Map<string, number>();
  for (const r of currentRows) principalRevenue.set(r.principal, (principalRevenue.get(r.principal) ?? 0) + r.revenue);

  const byPrincipal = [...groupRows(currentRows, (r) => [sfaOutletKey(r.sfaCustomer), r.principal], names).values()];
  byPrincipal.sort((a, b) => rankOf(a.parts[0]) - rankOf(b.parts[0]) || byRevenueDesc(a, b));
  const principalRows = byPrincipal.map((g) => {
    const { cases, revenue, grossProfit, reps, docs, periods, name } = g.acc;
    return [rankOf(g.parts[0]), name, g.parts[1], docs, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, outletRevenue.get(g.parts[0]) ?? 0), share(revenue, principalRevenue.get(g.parts[1]) ?? 0), reps.size, periods.size];
  });

  const byRep = [...groupRows(currentRows, (r) => [sfaOutletKey(r.sfaCustomer), r.repName || "Unassigned"], names).values()];
  byRep.sort((a, b) => rankOf(a.parts[0]) - rankOf(b.parts[0]) || byRevenueDesc(a, b));
  const repRows = byRep.map((g) => {
    const { cases, revenue, grossProfit, principals, docs, periods, name } = g.acc;
    return [rankOf(g.parts[0]), name, g.parts[1], joinSorted(principals), docs, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, outletRevenue.get(g.parts[0]) ?? 0), periods.size];
  });

  // The billing accounts and the outlets that sit behind them: where one account hides many customers.
  const byAccount = [...groupRows(currentRows, (r) => [r.cardCode, accountOf(r)], names).values()];
  byAccount.sort(byRevenueDesc);
  const outletsOfAccount = new Map<string, Map<string, { name: string; revenue: number }>>();
  for (const row of currentRows) {
    const accountKey = `${row.cardCode}${SEP}${accountOf(row)}`;
    const map = outletsOfAccount.get(accountKey) ?? new Map<string, { name: string; revenue: number }>();
    const key = sfaOutletKey(row.sfaCustomer);
    const entry = map.get(key) ?? { name: names.get(key) ?? outletOf(row), revenue: 0 };
    entry.revenue += row.revenue;
    map.set(key, entry);
    outletsOfAccount.set(accountKey, map);
  }
  const accountRows = byAccount.map((g) => {
    const { cases, revenue, grossProfit, docs, periods } = g.acc;
    const outlets = [...(outletsOfAccount.get(g.parts.join(SEP))?.values() ?? [])].sort((a, b) => b.revenue - a.revenue);
    const top = outlets[0];
    const listed = outlets.slice(0, MAX_OUTLETS_LISTED).map((o) => (revenue > 0 ? `${o.name} (${r1((o.revenue / revenue) * 100)}%)` : o.name));
    return [
      g.parts[0], g.parts[1], outlets.length, top?.name ?? "", top ? share(top.revenue, revenue) : "", outlets.length > MAX_OUTLETS_LISTED ? `${listed.join(", ")} +${outlets.length - MAX_OUTLETS_LISTED} more` : listed.join(", "),
      joinSorted(g.acc.principals), docs, r2(cases), r2(revenue), r2(grossProfit), marginOf(grossProfit, revenue), share(revenue, totalRevenue), periods.size,
    ];
  });

  const rawRows = [...currentRows]
    .sort((a, b) => periodOf(a).localeCompare(periodOf(b)) || a.principal.localeCompare(b.principal) || outletOf(a).localeCompare(outletOf(b)) || a.repName.localeCompare(b.repName))
    .map((r) => {
      const period = periodOf(r);
      return [
        MONTH_NAMES[r.monthIndex], Number(r.year), period, names.get(sfaOutletKey(r.sfaCustomer)) ?? outletOf(r), r.sfaContact, accountOf(r), r.cardCode, r.principal, r.repName || "Unassigned",
        r.docCount, r2(r.cases), r2(r.revenue), r2(r.grossProfit), marginOf(r.grossProfit, r.revenue), share(r.revenue, totalRevenue),
      ];
    });

  const periods = [...new Set(currentRows.map(periodOf))].sort();
  const cases = currentRows.reduce((s, r) => s + r.cases, 0);
  const grossProfit = currentRows.reduce((s, r) => s + r.grossProfit, 0);
  const summary: ExtractCell[][] = [
    ["Extract", "Customer analysis, detailed (SFA outlets)"],
    ["Principal", scope.principalLabel],
    ["Period", scope.periodLabel],
    ["Months with sales", periods.map(periodLabelOf).join(", ") || "None"],
    ["Generated", scope.generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    [],
    ["Revenue (value)", r2(totalRevenue)],
    ["Cases (volume)", r2(cases)],
    ["Gross profit", r2(grossProfit)],
    ["Gross margin %", marginOf(grossProfit, totalRevenue)],
    ["Customers (SFA outlets)", perOutlet.size],
    ["SAP billing accounts", new Set(currentRows.map((r) => `${r.cardCode}${SEP}${accountOf(r)}`)).size],
    ["Sales reps who sold", new Set(currentRows.map((r) => r.repName || "Unassigned")).size],
    [],
    ["Customer", "The outlet the SFA app sold to (SAP U_CustomerName), matched ignoring case, spacing and punctuation. A trailing phone number is shown as SFA Contact. Where SFA left the name blank the billing account name is used (Name Source says which)."],
    ["Billing account", "The SAP account the invoice is raised on (CardName). One account can sit above many outlets, such as a van, route or Cash Customer account: see the Billing Accounts sheet."],
    ["Contribution %", "A line's revenue as a percentage of the revenue shown for the same filter (or of its customer, principal or month where the column says so)."],
    ["Reps who sold", "Reps ordered by revenue with their share of that customer's revenue, as recorded against the SAP salesperson."],
    ["Documents", "Invoices and credit notes, counted per principal: a document carrying two principals counts once under each."],
    ["Tier", "Strategic: the customers making up the first 80% of positive revenue. Growth: the next 15%. Long Tail: the rest. Adjustment: zero or negative revenue."],
    ["Gross profit", "The dashboard's own definition (gross sales less purchase-price cost), the same as the rest of the app."],
    ["Prior-year revenue", priorAvailable ? "The same months of the previous year for the same filter, at outlet level; YoY growth compares the full selected period with it." : "Not included: the previous year's sales are not loaded at SFA-outlet level yet."],
    ["Raw Data sheet", "One row per month, principal, billing account, outlet and rep, as held in the SFA-outlet sales table."],
  ];

  const sheets: ExtractSheet[] = [
    { name: "Summary", columns: ["Detail", "Value"], rows: summary },
    {
      name: "Customer Ranking",
      columns: ["Rank", "SFA Customer", "SFA Contact", "Billing Account(s)", "Name Source", "Tier", "Principal(s)", "Reps Who Sold", "Reps", "Months Active", "First Purchase", "Last Purchase", "Documents", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution %", "Cumulative %", "Avg Monthly Revenue", "Prior-Year Revenue", "YoY Growth %"],
      rows: rankingRows,
    },
    {
      name: "Customer by Month",
      columns: ["Month", "Year", "Period", "SFA Customer", "Billing Account(s)", "Principal(s)", "Reps", "Reps Who Sold", "Documents", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Month"],
      rows: monthlyRows,
    },
    {
      name: "Customer by Principal",
      columns: ["Customer Rank", "SFA Customer", "Principal", "Documents", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Customer", "Contribution % of Principal", "Reps", "Months Bought"],
      rows: principalRows,
    },
    {
      name: "Customer by Rep",
      columns: ["Customer Rank", "SFA Customer", "Sales Rep", "Principal(s)", "Documents", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Customer", "Months Bought"],
      rows: repRows,
    },
    {
      name: "Billing Accounts",
      columns: ["Card Code", "Billing Account", "SFA Outlets", "Top Outlet", "Top Outlet Share %", "Outlets Behind the Account", "Principal(s)", "Documents", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Total", "Months Active"],
      rows: accountRows,
    },
    {
      name: "Raw Data",
      columns: ["Month", "Year", "Period", "SFA Customer", "SFA Contact", "Billing Account", "Card Code", "Principal", "Sales Rep", "Documents", "Cases (Volume)", "Revenue (Value)", "Gross Profit", "Margin %", "Contribution % of Total"],
      rows: rawRows,
    },
  ];
  return { sheets, rawRowCount: rawRows.length };
}
