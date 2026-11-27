// Trading terms: how much of each principal's sales went out on cash terms and on credit, which terms each customer buys on
// with each principal, and the customers making 80% of sales. Built from SAP invoice and credit note lines, using the payment
// term on each document (not the account's term today). Pure, no I/O.
//
// Cash and credit are what was AGREED on the document: a cash term does not show that the invoice was paid on the day.
// The customer is the SFA customer name, as in the customer analysis (lib/salesLines.ts).
import type { ExtractCell, ExtractSheet } from "./brandCustomerExtract";
import { normalizePrincipalKey } from "./normalize";
import { lineCustomerKey, rawCsvCell, splitSfaCustomer } from "./salesLines";

export type TermClass = "Cash" | "Credit" | "Not recorded";

/** Cash when the term's name says Cash or COD; every other named term is credit, whatever days SAP holds against it. */
export function termClass(term: string | null): TermClass {
  if (!term?.trim()) return "Not recorded";
  return /\bcash\b|\bc\.?o\.?d\b/i.test(term) ? "Cash" : "Credit";
}

/** A term's name as shown: SAP writes its default as "- Cash Basic -", whose dashes a spreadsheet would read as a formula. */
export const termName = (term: string | null) => term?.replace(/^[\s-]+|[\s-]+$/g, "") || "Not recorded";

/** Accounts that carry sales but are not customers: left out of the customer rankings, listed separately. */
const NOT_A_CUSTOMER = [/^stock lost/i, /^mars wrigley confectionery/i, /^bidco africa/i];
export const isNotACustomer = (name: string) => NOT_A_CUSTOMER.some((pattern) => pattern.test(name.trim()));

/** Net sales of one principal in one month on one term. */
export interface TermMonthRow {
  principal: string;
  month: string; // YYYY-MM
  paymentTerm: string | null;
  paymentTermDays: number | null;
  sales: number;
}

/** Net sales of one SFA name, SAP account, principal and term. */
export interface TermCustomerRow {
  principal: string;
  sfaName: string | null;
  customerName: string;
  cardCode: string;
  paymentTerm: string | null;
  paymentTermDays: number | null;
  sales: number;
  invoices: number;
  /** Invoice value, and the same value times the days from invoice date to due date, over invoices that carry a due date. */
  datedValue: number;
  dayValue: number;
  lastInvoice: string | null; // YYYY-MM-DD
}

/** What SAP holds about an account today, from the receivables sync. */
export interface TermAccount {
  term: string | null;
  creditLimit: number;
  outstanding: number;
}

interface Split {
  sales: number;
  cash: number;
  credit: number;
  unrecorded: number;
}

const emptySplit = (): Split => ({ sales: 0, cash: 0, credit: 0, unrecorded: 0 });
function addSplit(target: Split, term: string | null, value: number) {
  const kind = termClass(term);
  target.sales += value;
  if (kind === "Cash") target.cash += value;
  else if (kind === "Credit") target.credit += value;
  else target.unrecorded += value;
}

/** A customer's buying with one principal (or, summed, with all of them). */
interface Holding extends Split {
  terms: Map<string, { sales: number; days: number | null }>;
  accounts: Map<string, { sales: number; name: string }>;
  invoices: number;
  datedValue: number;
  dayValue: number;
  lastInvoice: string;
}

const emptyHolding = (): Holding => ({ ...emptySplit(), terms: new Map(), accounts: new Map(), invoices: 0, datedValue: 0, dayValue: 0, lastInvoice: "" });

function addHolding(holding: Holding, row: TermCustomerRow) {
  addSplit(holding, row.paymentTerm, row.sales);
  const name = termName(row.paymentTerm);
  const term = holding.terms.get(name) ?? { sales: 0, days: row.paymentTermDays };
  term.sales += row.sales;
  holding.terms.set(name, term);
  const account = holding.accounts.get(row.cardCode) ?? { sales: 0, name: row.customerName };
  account.sales += row.sales;
  holding.accounts.set(row.cardCode, account);
  holding.invoices += row.invoices;
  holding.datedValue += row.datedValue;
  holding.dayValue += row.dayValue;
  if ((row.lastInvoice ?? "") > holding.lastInvoice) holding.lastInvoice = row.lastInvoice ?? "";
}

const bySales = <T extends { sales: number }>(map: Map<string, T>) => [...map.entries()].sort((a, b) => b[1].sales - a[1].sales || a[0].localeCompare(b[0]));
/** The term (or account) carrying most of the sales. */
const mainOf = <T extends { sales: number }>(map: Map<string, T>): [string, T] => bySales(map)[0];

/** The family a dashboard principal belongs to: "Mars-Nairobi" and "Mars-Nyeri" are both Mars. */
const familyName = (principal: string) => principal.split("-")[0].trim();

export interface PrincipalTerms extends Split {
  principal: string;
  customers: number;
  cashCustomers: number;
  creditCustomers: number;
  /** Customers making 80% of the principal's sales. */
  topCustomers: number;
}

export interface TradingTermsSummary {
  total: Split;
  principals: PrincipalTerms[];
  terms: { term: string; kind: TermClass; days: number | null; sales: number; customers: number }[];
  customers: number;
  topCustomers: number;
  topSales: number;
  /** Customers whose main term is not the same with every principal they buy. */
  differingCustomers: number;
  differingSales: number;
  leftOut: { customer: string; sales: number }[];
}

export interface TradingTermsScope {
  principalLabel: string;
  periodLabel: string;
  generatedAt: Date;
  dataAsOf: Date | null;
  receivablesAsOf: Date | null;
  missingMonths: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): ExtractCell => (whole > 0 ? r1((part / whole) * 100) : "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const SPLIT_COLUMNS = ["Net Sales", "Cash Sales", "Credit Sales", "Sales Not Recorded", "Cash %", "Credit %", "Not Recorded %"];
const splitCells = (s: Split): ExtractCell[] => [r2(s.sales), r2(s.cash), r2(s.credit), r2(s.unrecorded), pct(s.cash, s.sales), pct(s.credit, s.sales), pct(s.unrecorded, s.sales)];

const termList = (holding: Holding) => bySales(holding.terms).map(([name, term]) => `${name}${holding.terms.size > 1 && holding.sales > 0 ? ` ${Math.round((term.sales / holding.sales) * 100)}%` : ""}`).join(", ");
const cashOrCredit = (holding: Holding) => (holding.cash > 0 && holding.credit > 0 ? "Both" : termClass(mainOf(holding.terms)[0] === "Not recorded" ? null : mainOf(holding.terms)[0]));

interface Customer {
  key: string;
  all: Holding;
  principals: Map<string, Holding>; // by principal family
}

interface Ranked {
  customer: Customer;
  holding: Holding;
  rank: number;
  share: number;
  cumulative: number;
  /** Among the customers making up the first 80% of sales. */
  top: boolean;
}

function rank(list: { customer: Customer; holding: Holding }[]): Ranked[] {
  const sorted = [...list].sort((a, b) => b.holding.sales - a.holding.sales || a.customer.key.localeCompare(b.customer.key));
  const total = sorted.reduce((sum, entry) => sum + entry.holding.sales, 0);
  let cumulative = 0;
  return sorted.map((entry, index) => {
    const share = total ? entry.holding.sales / total : 0;
    const before = cumulative;
    cumulative += share;
    return { ...entry, rank: index + 1, share, cumulative, top: total > 0 && entry.holding.sales > 0 && before < 0.8 };
  });
}

export function buildTradingTerms(monthRows: TermMonthRow[], customerRows: TermCustomerRow[], accounts: Map<string, TermAccount>) {
  const customers = new Map<string, Customer>();
  const leftOut = new Map<string, number>();
  const accountCustomers = new Map<string, Set<string>>();
  const termTotals = new Map<string, { days: number | null; sales: number; customers: Set<string> }>();

  for (const row of customerRows) {
    const key = lineCustomerKey(splitSfaCustomer(row.sfaName, row.customerName).sfaCustomer);
    const sharing = accountCustomers.get(row.cardCode) ?? new Set<string>();
    sharing.add(key);
    accountCustomers.set(row.cardCode, sharing);
    const name = termName(row.paymentTerm);
    const term = termTotals.get(name) ?? { days: row.paymentTermDays, sales: 0, customers: new Set<string>() };
    term.sales += row.sales;
    term.customers.add(key);
    termTotals.set(name, term);
    if (isNotACustomer(row.customerName) || isNotACustomer(key)) {
      leftOut.set(key, (leftOut.get(key) ?? 0) + row.sales);
      continue;
    }
    let customer = customers.get(key);
    if (!customer) customers.set(key, (customer = { key, all: emptyHolding(), principals: new Map() }));
    addHolding(customer.all, row);
    const family = normalizePrincipalKey(row.principal);
    let holding = customer.principals.get(family);
    if (!holding) customer.principals.set(family, (holding = emptyHolding()));
    addHolding(holding, row);
  }

  // Sales by principal family and by principal as the dashboard holds it (family and branch).
  const familyLabels = new Map<string, string>();
  const families = new Map<string, Split & { months: Map<string, Split> }>();
  const branches = new Map<string, Split>();
  const total = emptySplit();
  const months = new Set<string>();
  const totalMonths = new Map<string, Split>();
  for (const row of [...monthRows].sort((a, b) => a.principal.localeCompare(b.principal))) {
    const family = normalizePrincipalKey(row.principal);
    if (!familyLabels.has(family)) familyLabels.set(family, familyName(row.principal));
    let split = families.get(family);
    if (!split) families.set(family, (split = { ...emptySplit(), months: new Map() }));
    const monthSplit = split.months.get(row.month) ?? emptySplit();
    split.months.set(row.month, monthSplit);
    const totalMonth = totalMonths.get(row.month) ?? emptySplit();
    totalMonths.set(row.month, totalMonth);
    const branch = branches.get(row.principal) ?? emptySplit();
    branches.set(row.principal, branch);
    for (const target of [split, monthSplit, branch, total, totalMonth]) addSplit(target, row.paymentTerm, row.sales);
    months.add(row.month);
  }

  const ranked = rank([...customers.values()].map((customer) => ({ customer, holding: customer.all })));
  const topList = ranked.filter((entry) => entry.top);
  const inTop = new Set(topList.map((entry) => entry.customer.key));
  const orderedFamilies = [...families.entries()].sort((a, b) => b[1].sales - a[1].sales);
  const rankedByFamily = new Map(
    orderedFamilies.map(([family]) => [family, rank([...customers.values()].flatMap((customer) => (customer.principals.has(family) ? [{ customer, holding: customer.principals.get(family)! }] : [])))])
  );
  // A principal the customer only returned goods to says nothing about the terms it buys on.
  const differs = (customer: Customer) => new Set([...customer.principals.values()].filter((holding) => holding.sales > 0).map((holding) => mainOf(holding.terms)[0])).size > 1;
  const differing = ranked.filter((entry) => differs(entry.customer));

  const summary: TradingTermsSummary = {
    total,
    principals: orderedFamilies.map(([family, split]) => {
      const list = rankedByFamily.get(family)!;
      return {
        principal: familyLabels.get(family)!,
        sales: split.sales,
        cash: split.cash,
        credit: split.credit,
        unrecorded: split.unrecorded,
        customers: list.length,
        cashCustomers: list.filter((entry) => entry.holding.cash > 0).length,
        creditCustomers: list.filter((entry) => entry.holding.credit > 0).length,
        topCustomers: list.filter((entry) => entry.top).length,
      };
    }),
    terms: bySales(termTotals).map(([term, value]) => ({ term, kind: termClass(term === "Not recorded" ? null : term), days: value.days, sales: value.sales, customers: value.customers.size })),
    customers: customers.size,
    topCustomers: topList.length,
    topSales: topList.reduce((sum, entry) => sum + entry.holding.sales, 0),
    differingCustomers: differing.length,
    differingSales: differing.reduce((sum, entry) => sum + entry.holding.sales, 0),
    leftOut: [...leftOut.entries()].map(([customer, sales]) => ({ customer, sales })).sort((a, b) => b.sales - a.sales),
  };

  const daysAllowed = (holding: Holding): ExtractCell => (holding.datedValue > 0 ? r1(holding.dayValue / holding.datedValue) : "");
  const ACCOUNT_COLUMNS = ["Main Account Code", "Account Name", "Accounts Used", "Account Term Today", "Account Credit Limit", "Account Outstanding", "Customers Sharing Account"];
  /** SAP's view of the account carrying most of the sales. One account can serve many SFA customers, so the last column says
   *  how many share it: its limit and balance belong to all of them. */
  const accountCells = (holding: Holding): ExtractCell[] => {
    const [code, main] = mainOf(holding.accounts);
    const account = accounts.get(code);
    return [code, main.name, holding.accounts.size, account?.term ?? "", account ? r2(account.creditLimit) : "", account ? r2(account.outstanding) : "", accountCustomers.get(code)?.size ?? 1];
  };
  const HOLDING_COLUMNS = ["Main Term", "Term Days (SAP)", "Cash or Credit", "All Terms Used", "Avg Days to Due Date", ...SPLIT_COLUMNS, "Invoices", "Last Invoice", ...ACCOUNT_COLUMNS];
  const holdingCells = (holding: Holding): ExtractCell[] => {
    const [term, main] = mainOf(holding.terms);
    return [term, main.days ?? "", cashOrCredit(holding), termList(holding), daysAllowed(holding), ...splitCells(holding), holding.invoices, holding.lastInvoice, ...accountCells(holding)];
  };
  const principalsOf = (customer: Customer) => bySales(customer.principals);
  const termsByPrincipal = (customer: Customer) => principalsOf(customer).map(([family, holding]) => `${familyLabels.get(family)}: ${mainOf(holding.terms)[0]}`).join("; ");

  const periodMonths = [...months].sort();

  function sheets(scope: TradingTermsScope): ExtractSheet[] {
    const stamp = (value: Date) => value.toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const summaryRows: ExtractCell[][] = [
      ["Report", "Trading terms: cash and credit, customer terms and the customers making 80% of sales"],
      ["Principal", scope.principalLabel],
      ["Period", scope.periodLabel],
      ["Generated", stamp(scope.generatedAt)],
      ["Sales read from SAP", scope.dataAsOf ? stamp(scope.dataAsOf) : ""],
      ["Account balances as at", scope.receivablesAsOf ? stamp(scope.receivablesAsOf) : ""],
      ...(scope.missingMonths.length > 0 ? [["Months not loaded (left out)", scope.missingMonths.join(", ")] as ExtractCell[]] : []),
      [],
      ["Net sales", r2(total.sales)],
      ["Cash sales %", pct(total.cash, total.sales)],
      ["Credit sales %", pct(total.credit, total.sales)],
      ["Sales with no term recorded %", pct(total.unrecorded, total.sales)],
      ["Customers", summary.customers],
      ["Customers making 80% of sales", summary.topCustomers],
      ["Their sales", r2(summary.topSales)],
      ["Customers on different terms with different principals", summary.differingCustomers],
      ["Their sales", r2(summary.differingSales)],
      [],
      ["Net sales", "SAP invoices less credit notes, excluding VAT."],
      ["Cash or credit", "The payment term on each invoice or credit note. Cash = the term's name says Cash or COD; every other term is credit. It is the term agreed, not proof of when the money came in."],
      ["Customer", "The SFA customer name (SAP U_CustomerName, else the SAP customer name), matched ignoring case and repeated spaces."],
      ["Principal", "Branches are counted as one principal (Mars-Nairobi and Mars-Nyeri are both Mars). Principal by Branch splits them."],
      ["Main Term", "The term carrying most of the customer's sales. All Terms Used gives the share of each where there is more than one."],
      ["Different terms", "The customer's main term is not the same with every principal it buys."],
      ["Avg Days to Due Date", "Days from invoice date to due date as SAP set it on each invoice, weighted by value. Compare with Term Days where a term looks wrongly set up."],
      ["Account columns", "SAP's term, credit limit and open balance for the main account today. Several customers can share one account: Customers Sharing Account says how many, within this selection."],
      ["Left out of customer rankings", summary.leftOut.length ? summary.leftOut.map((entry) => `${entry.customer} (${r2(entry.sales).toLocaleString("en-US")})`).join("; ") : "None in this selection"],
    ];

    const principalColumns = ["Principal", ...SPLIT_COLUMNS, "Customers", "Customers on Cash Terms", "Customers on Credit Terms", "Customers Making 80%"];
    const principalRows = summary.principals.map((p): ExtractCell[] => [p.principal, ...splitCells(p), p.customers, p.cashCustomers, p.creditCustomers, p.topCustomers]);
    principalRows.push(["Total", ...splitCells(total), summary.customers, ranked.filter((e) => e.holding.cash > 0).length, ranked.filter((e) => e.holding.credit > 0).length, summary.topCustomers]);

    const monthly = (label: string, byMonth: Map<string, Split>, whole: Split): ExtractCell[] => [
      label,
      pct(whole.credit, whole.sales),
      ...periodMonths.flatMap((month) => {
        const split = byMonth.get(month) ?? emptySplit();
        return [pct(split.cash, split.sales), pct(split.credit, split.sales)];
      }),
    ];

    const allTerms = summary.terms.map((t) => t.term);
    const termMatrix = new Map<string, Map<string, number>>();
    for (const row of monthRows) {
      const family = normalizePrincipalKey(row.principal);
      const cells = termMatrix.get(family) ?? new Map<string, number>();
      const name = termName(row.paymentTerm);
      cells.set(name, (cells.get(name) ?? 0) + row.sales);
      termMatrix.set(family, cells);
    }

    return [
      { name: "Summary", columns: ["Detail", "Value"], rows: summaryRows },
      { name: "Cash vs Credit by Principal", columns: principalColumns, rows: principalRows },
      {
        name: "Cash vs Credit by Month",
        columns: ["Principal", "Period Credit %", ...periodMonths.flatMap((month) => [`${monthLabel(month)} Cash %`, `${monthLabel(month)} Credit %`])],
        rows: [...orderedFamilies.map(([family, split]) => monthly(familyLabels.get(family)!, split.months, split)), monthly("Total", totalMonths, total)],
      },
      { name: "Principal by Branch", columns: ["Principal (Branch)", ...SPLIT_COLUMNS], rows: bySales(branches).map(([branch, split]) => [branch, ...splitCells(split)]) },
      {
        name: "Sales % by Term",
        columns: ["Principal", "Net Sales", ...allTerms.map((term) => `${term} %`)],
        rows: orderedFamilies.map(([family, split]) => [familyLabels.get(family)!, r2(split.sales), ...allTerms.map((term) => pct(termMatrix.get(family)?.get(term) ?? 0, split.sales))]),
      },
      {
        name: "Top 80% Customers",
        columns: ["Rank", "Customer", "% Share", "Cumulative %", "Principals Bought", "Different Terms by Principal", "Terms by Principal", ...HOLDING_COLUMNS],
        rows: topList.map((e) => [e.rank, e.customer.key, pct(e.share, 1), pct(e.cumulative, 1), e.customer.principals.size, differs(e.customer) ? "Yes" : "", termsByPrincipal(e.customer), ...holdingCells(e.holding)]),
      },
      {
        name: "Top 80% by Principal",
        columns: ["Principal", "Rank", "Customer", "% of Principal", "Cumulative %", ...HOLDING_COLUMNS],
        rows: orderedFamilies.flatMap(([family]) =>
          rankedByFamily
            .get(family)!
            .filter((e) => e.top)
            .map((e): ExtractCell[] => [familyLabels.get(family)!, e.rank, e.customer.key, pct(e.share, 1), pct(e.cumulative, 1), ...holdingCells(e.holding)])
        ),
      },
      {
        name: "Different Terms",
        columns: ["Customer", "In Top 80%", "Customer Sales (all principals)", "Principal", ...HOLDING_COLUMNS],
        rows: differing.flatMap((e) => principalsOf(e.customer).map(([family, holding]): ExtractCell[] => [e.customer.key, inTop.has(e.customer.key) ? "Yes" : "", r2(e.holding.sales), familyLabels.get(family)!, ...holdingCells(holding)])),
      },
    ];
  }

  /** Every customer's terms with every principal, as CSV: too many rows for the workbook on a long period. */
  function* csv(): Generator<string> {
    const line = (cells: ExtractCell[]) => `${cells.map((cell) => rawCsvCell(cell ?? "")).join(",")}\r\n`;
    yield line(["Customer", "Customer Rank", "In Top 80%", "Different Terms by Principal", "Principal", ...HOLDING_COLUMNS]);
    for (const e of ranked) {
      const different = differs(e.customer) ? "Yes" : "";
      for (const [family, holding] of principalsOf(e.customer)) {
        yield line([e.customer.key, e.rank, e.top ? "Yes" : "", different, familyLabels.get(family)!, ...holdingCells(holding)]);
      }
    }
  }

  return { summary, sheets, csv };
}
