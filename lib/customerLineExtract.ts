// The Customer extract built from SAP invoice lines, the way the desktop "SAP B1 Detailed Sales Extraction" tool builds its
// customer ranking: the customer is the SFA customer name (see lib/salesLines.ts), ranked by sales across the selection and
// again within each principal, with ABC class, main rep and main customer code. Each customer carries its SFA outlet's
// channel, segment and territory (lib/customerOutlets.ts), and the same lines give the performance views: top 50, the
// customers making 80% of sales, top customers and concentration by principal, and sales by channel, segment, territory
// and Team Leader. The raw data sheet carries every line. Lines are fed in batches so a long period never has to sit in
// memory at once. Pure, no I/O.
import type { BrandCustomerExtract, ExtractCell, ExtractScope, ExtractSheet } from "./brandCustomerExtract";
import { createOutletResolver, NOT_MATCHED, OUTLET_COLUMNS, outletCells, type OutletAttributes, type OutletDirectory, type OutletMatch } from "./customerOutlets";
import { lineCustomerKey, lineMeasures, RAW_LINE_COLUMNS, rawLineRow, splitSfaCustomer, type SalesLineRecord } from "./salesLines";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number): ExtractCell => (whole > 0 ? r1((part / whole) * 100) : "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const TOP_CUSTOMERS = 50;
const TOP_PER_PRINCIPAL = 20;
/** Above this many rows the full ranking by principal is left out: a long period across every principal would otherwise be too
 *  heavy to build in the app. The top customers of each principal are always there. */
const PRINCIPAL_RANK_ROW_LIMIT = 30_000;
const SEP = "\u0001";

/** The fields the ranking needs; the raw data sheet needs the whole line. */
export type RankingLine = Pick<
  SalesLineRecord,
  "docType" | "docEntry" | "docDate" | "cardCode" | "customerName" | "sfaName" | "salesEmployee" | "principal" | "itemCode" | "quantity" | "inventoryQty" | "packSize" | "priceBeforeDiscount" | "unitCost" | "salesAmount"
>;

/** A line with the outlet its invoice reference points to ("SOURCE|key"), where it has one. */
export type LinkedLine<T extends RankingLine = RankingLine> = T & { outletId: string | null };

interface Customer {
  sales: number;
  cases: number;
  skus: Set<string>;
  invoices: Set<number>;
  principals: Set<string>;
  principalSales: Map<string, number>;
  reps: Map<string, number>;
  codes: Map<string, { lines: number; name: string }>;
  contacts: Map<string, number>;
  months: Map<string, number>;
  lastInvoice: string;
  prefilledLines: number;
  lines: number;
}

/** Sales of one customer, principal and referenced outlet: the grain the channel, segment and territory views are built from. */
interface Bucket {
  customer: string;
  principal: string;
  outletId: string | null;
  sales: number;
  cases: number;
  invoices: Set<number>;
  months: Map<string, number>;
}

const bump = <K,>(map: Map<K, number>, key: K, value: number) => map.set(key, (map.get(key) ?? 0) + value);
const top = <K,>(map: Map<K, number>): K | undefined => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

function addTo(customers: Map<string, Customer>, key: string, line: RankingLine, cases: number, prefilled: boolean, contact: string) {
  let customer = customers.get(key);
  if (!customer) {
    customer = { sales: 0, cases: 0, skus: new Set(), invoices: new Set(), principals: new Set(), principalSales: new Map(), reps: new Map(), codes: new Map(), contacts: new Map(), months: new Map(), lastInvoice: "", prefilledLines: 0, lines: 0 };
    customers.set(key, customer);
  }
  customer.sales += line.salesAmount;
  customer.cases += cases;
  customer.lines += 1;
  if (prefilled) customer.prefilledLines += 1;
  if (contact) bump(customer.contacts, contact, 1);
  bump(customer.reps, line.salesEmployee, line.salesAmount);
  bump(customer.principalSales, line.principal, line.salesAmount);
  bump(customer.months, line.docDate.slice(0, 7), line.salesAmount);
  const code = customer.codes.get(line.cardCode) ?? { lines: 0, name: line.customerName };
  code.lines += 1;
  customer.codes.set(line.cardCode, code);
  // Productivity counts what was invoiced; credit notes only move the value.
  if (line.docType === "INVOICE") {
    customer.skus.add(line.itemCode);
    customer.invoices.add(line.docEntry);
    customer.principals.add(line.principal);
    if (line.docDate > customer.lastInvoice) customer.lastInvoice = line.docDate;
  }
}

/** Class A: the customers making up the first 80% of sales, B the next 15%, C the rest. */
function abcClass(shareBefore: number): "A" | "B" | "C" {
  return shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C";
}

interface Ranked {
  key: string;
  rank: number;
  customer: Customer;
  share: number;
  cumulative: number;
  grade: "A" | "B" | "C";
}

function rank(customers: Map<string, Customer>): Ranked[] {
  const sorted = [...customers.entries()].sort((a, b) => b[1].sales - a[1].sales || a[0].localeCompare(b[0]));
  const total = sorted.reduce((sum, [, c]) => sum + c.sales, 0);
  let cumulative = 0;
  return sorted.map(([key, customer], index) => {
    const share = total ? customer.sales / total : 0;
    cumulative += share;
    // A customer with nothing sold on balance cannot be part of what makes up the sales.
    const grade = total && customer.sales > 0 ? abcClass(cumulative - share) : "C";
    return { key, rank: index + 1, customer, share, cumulative, grade };
  });
}

const RANKING_COLUMNS = ["Rank", "Customer", "Sales Value", "Cases", "SKUs Bought", "Invoices", "Main Rep", "Customer Code", "Customer Name", "Customer Ref Remarks", "% Share", "Cumulative %", "Class"];
const PROFILE_COLUMNS = ["SFA Contact", "Last Invoice", "Months Bought", "Avg Monthly Sales", "Outlets", ...OUTLET_COLUMNS];

function rankingCells(entry: Ranked): ExtractCell[] {
  const c = entry.customer;
  const [mainCode, main] = [...c.codes.entries()].sort((a, b) => b[1].lines - a[1].lines)[0];
  return [
    entry.rank, entry.key, r2(c.sales), r2(c.cases), c.skus.size, c.invoices.size, top(c.reps) ?? "", mainCode, main.name, c.prefilledLines === c.lines ? "Prefilled" : "Original",
    pct(entry.share, 1), pct(entry.cumulative, 1), entry.grade,
  ];
}

export interface LineExtractOptions {
  /** Above this many lines the raw data sheet is left out and the Summary points to the CSV download. */
  rawRowLimit: number;
  directory: OutletDirectory;
  /** Overrides PRINCIPAL_RANK_ROW_LIMIT. */
  principalRankRowLimit?: number;
}

export function createCustomerLineExtract(options: LineExtractOptions) {
  const resolver = createOutletResolver(options.directory);
  const overall = new Map<string, Customer>();
  const byPrincipal = new Map<string, Map<string, Customer>>();
  const buckets = new Map<string, Bucket>();
  const principalSales = new Map<string, number>();
  const months = new Set<string>();
  let raw: LinkedLine<SalesLineRecord>[] | null = [];
  let lines = 0;
  let sales = 0;
  let cases = 0;
  let prefilledLines = 0;
  let linesWithoutCost = 0;

  return {
    /** Adds a batch. `whole` says the batch carries every column, which the raw data sheet needs. */
    add(batch: LinkedLine[] | LinkedLine<SalesLineRecord>[], whole: boolean) {
      for (const line of batch) {
        const split = splitSfaCustomer(line.sfaName, line.customerName);
        const key = lineCustomerKey(split.sfaCustomer);
        const measures = lineMeasures(line);
        const lineCases = measures.cases ?? 0;
        const prefilled = split.remarks === "Prefilled";
        const month = line.docDate.slice(0, 7);
        lines += 1;
        sales += line.salesAmount;
        cases += lineCases;
        months.add(month);
        if (prefilled) prefilledLines += 1;
        if (measures.cogs === null) linesWithoutCost += 1;
        resolver.observe(key, line.outletId);
        addTo(overall, key, line, lineCases, prefilled, split.sfaContact);
        let principal = byPrincipal.get(line.principal);
        if (!principal) byPrincipal.set(line.principal, (principal = new Map()));
        addTo(principal, key, line, lineCases, prefilled, split.sfaContact);
        bump(principalSales, line.principal, line.salesAmount);
        const bucketKey = `${key}${SEP}${line.principal}${SEP}${line.outletId ?? ""}`;
        let bucket = buckets.get(bucketKey);
        if (!bucket) buckets.set(bucketKey, (bucket = { customer: key, principal: line.principal, outletId: line.outletId, sales: 0, cases: 0, invoices: new Set(), months: new Map() }));
        bucket.sales += line.salesAmount;
        bucket.cases += lineCases;
        if (line.docType === "INVOICE") bucket.invoices.add(line.docEntry);
        bump(bucket.months, month, line.salesAmount);
      }
      if (raw) {
        if (!whole || lines > options.rawRowLimit) raw = null;
        else for (const line of batch as LinkedLine<SalesLineRecord>[]) raw.push(line);
      }
    },

    finish(scope: ExtractScope, dataAsOf: Date | null): BrandCustomerExtract {
      const periodMonths = [...months].sort();
      const monthColumns = periodMonths.map(monthLabel);
      const monthCells = (values: Map<string, number>) => periodMonths.map((month) => r2(values.get(month) ?? 0));
      const ranked = rank(overall);
      const principals = [...principalSales.entries()].sort((a, b) => b[1] - a[1]);
      const rankedByPrincipal = new Map(principals.map(([principal]) => [principal, rank(byPrincipal.get(principal)!)]));
      const mainPrincipal = (c: Customer) => top(c.principalSales) ?? "";
      const outletOfCustomer = new Map(ranked.map((entry) => [entry.key, resolver.customer(entry.key, mainPrincipal(entry.customer))]));
      const profile = (entry: Ranked, outlet: OutletAttributes): ExtractCell[] => {
        const c = entry.customer;
        return [top(c.contacts) ?? "", c.lastInvoice, c.months.size, r2(c.sales / Math.max(1, periodMonths.length)), resolver.outletCount(entry.key), ...outletCells(outlet)];
      };
      const fullRow = (entry: Ranked): ExtractCell[] => [...rankingCells(entry), entry.customer.principals.size, [...entry.customer.principals].sort().join(", "), ...profile(entry, outletOfCustomer.get(entry.key)!)];
      const fullColumns = [...RANKING_COLUMNS, "Principals Bought", "Principals", ...PROFILE_COLUMNS];
      const withMonths = (entry: Ranked) => [...fullRow(entry), ...monthCells(entry.customer.months)];
      const eighty = ranked.filter((entry) => entry.grade === "A");
      const inEighty = new Set(eighty.map((entry) => entry.key));

      const principalRankCount = [...rankedByPrincipal.values()].reduce((count, list) => count + list.length, 0);
      const principalRankRows =
        principalRankCount > (options.principalRankRowLimit ?? PRINCIPAL_RANK_ROW_LIMIT)
          ? null
          : principals.flatMap(([principal]) => rankedByPrincipal.get(principal)!.map((entry) => [principal, ...rankingCells(entry), ...profile(entry, resolver.customer(entry.key, principal))]));
      const topByPrincipalRows = principals.flatMap(([principal]) =>
        rankedByPrincipal.get(principal)!.slice(0, TOP_PER_PRINCIPAL).map((entry) => [principal, ...rankingCells(entry), ...profile(entry, resolver.customer(entry.key, principal)), ...monthCells(entry.customer.months)])
      );
      const concentrationRows = principals.map(([principal, value]) => {
        const list = rankedByPrincipal.get(principal)!;
        const classA = list.filter((entry) => entry.grade === "A").length;
        const first = list[0];
        const share = (count: number) => pct(list.slice(0, count).reduce((sum, entry) => sum + entry.customer.sales, 0), value);
        return [principal, r2(value), pct(value, sales), list.length, classA, pct(classA, list.length), first.key, r2(first.customer.sales), pct(first.customer.sales, value), share(10), share(TOP_CUSTOMERS)];
      });

      // Every bucket takes the attributes of its own referenced outlet, else of its customer's.
      const placed = [...buckets.values()].map((bucket) => ({ bucket, outlet: resolver.line(bucket.customer, bucket.principal, bucket.outletId) }));
      const dimension = (name: string, columns: string[], valuesOf: (outlet: OutletAttributes) => string[]): ExtractSheet => {
        const groups = new Map<string, { values: string[]; sales: number; cases: number; invoices: Set<number>; customers: Map<string, number>; months: Map<string, number> }>();
        for (const { bucket, outlet } of placed) {
          const values = valuesOf(outlet);
          const key = values.join(SEP);
          let group = groups.get(key);
          if (!group) groups.set(key, (group = { values, sales: 0, cases: 0, invoices: new Set(), customers: new Map(), months: new Map() }));
          group.sales += bucket.sales;
          group.cases += bucket.cases;
          for (const invoice of bucket.invoices) group.invoices.add(invoice);
          bump(group.customers, bucket.customer, bucket.sales);
          for (const [month, value] of bucket.months) bump(group.months, month, value);
        }
        const rows = [...groups.values()]
          .sort((a, b) => b.sales - a.sales)
          .map((group) => {
            const best = top(group.customers) ?? "";
            return [
              ...group.values, r2(group.sales), pct(group.sales, sales), r2(group.cases), group.customers.size, [...group.customers.keys()].filter((key) => inEighty.has(key)).length,
              group.invoices.size, r2(group.sales / Math.max(1, group.customers.size)), best, r2(group.customers.get(best) ?? 0), ...monthCells(group.months),
            ];
          });
        return { name, columns: [...columns, "Sales Value", "% Share", "Cases", "Customers", "Customers in Top 80%", "Invoices", "Sales per Customer", "Top Customer", "Top Customer Sales", ...monthColumns], rows };
      };

      const channelTotals = new Map<string, number>();
      const channelByPrincipal = new Map<string, number>();
      for (const { bucket, outlet } of placed) {
        bump(channelTotals, outlet.channel, bucket.sales);
        bump(channelByPrincipal, `${bucket.principal}${SEP}${outlet.channel}`, bucket.sales);
      }
      const channels = [...channelTotals.entries()].sort((a, b) => b[1] - a[1]).map(([channel]) => channel);
      const matrixRows = principals.map(([principal, value]) => [principal, ...channels.map((channel) => r2(channelByPrincipal.get(`${principal}${SEP}${channel}`) ?? 0)), r2(value)]);

      const matched = new Map<OutletMatch, number>();
      for (const { bucket, outlet } of placed) bump(matched, outlet.match, bucket.sales);

      const stamp = (value: Date) => value.toISOString().replace("T", " ").slice(0, 16) + " UTC";
      const eightySales = eighty.reduce((sum, entry) => sum + entry.customer.sales, 0);
      const summary: ExtractCell[][] = [
        ["Extract", "Customer analysis, detailed (SAP invoice lines)"],
        ["Principal", scope.principalLabel],
        ["Period", scope.periodLabel],
        ["Generated", stamp(scope.generatedAt)],
        ["Data read from SAP", dataAsOf ? stamp(dataAsOf) : ""],
        [],
        ["Sales value", r2(sales)],
        ["Cases", r2(cases)],
        ["Customers", overall.size],
        ["Customers making 80% of sales (class A)", eighty.length],
        ["Those as % of all customers", pct(eighty.length, overall.size)],
        ["Their sales", r2(eightySales)],
        ["Top 50 customers, % of sales", pct(ranked.slice(0, TOP_CUSTOMERS).reduce((sum, entry) => sum + entry.customer.sales, 0), sales)],
        ["Invoice and credit note lines", lines],
        ["Lines with the SAP name filled in (no SFA name)", prefilledLines],
        ["Lines with no purchase price (COGs and gross profit blank)", linesWithoutCost],
        [],
        ...(["Invoice reference", "Same customer", "Name", NOT_MATCHED] as OutletMatch[]).map((match): ExtractCell[] => [`Sales % with outlet: ${match}`, pct(matched.get(match) ?? 0, sales)]),
        [],
        ["Customer", "The SFA customer name (SAP U_CustomerName) with a trailing bracket moved to SFA Contact, matched ignoring case and repeated spaces. Where SAP has no SFA name the SAP customer name is filled in: Customer Ref Remarks says Prefilled."],
        ["Customer Code / Customer Name", "The SAP billing account carrying most of the customer's lines."],
        ["Outlet, channel, segment, region, territory", "From the SFA system's outlet list (Pine, Leverage, EABL DMS, Upfield DataEdge). Outlet Match says how it was found: Invoice reference (the invoice's own reference), Same customer (the outlet of the customer's other invoices), Name (the only outlet with that name) or Not matched."],
        ["Outlets", "Different outlets the customer's invoices point to. Above 1 means shops sharing a name, or one shop listed in more than one system, are counted as one customer."],
        ["Sales Value and Cases", "Invoices less credit notes. SKUs Bought, Invoices and Principals Bought count invoices only."],
        ["Class", "A = the customers making up the first 80% of sales, B = the next 15%, C = the last 5%. Ranked across the selection, and again within each principal."],
        ["Avg Monthly Sales", "Sales over the number of months in the selection; a month still running counts as a full one."],
        ["Gross profit", "Gross sales (quantity x price before discount) less inventory quantity x purchase price excluding VAT; zero on free lines, blank where there is no purchase price. It can differ from the figure on screen."],
        ["Paid Amount", "The whole document's paid amount, repeated on each of its lines: do not add it up."],
      ];

      const sheets: ExtractSheet[] = [
        { name: "Summary", columns: ["Detail", "Value"], rows: summary },
        { name: "Top 50 Customers", columns: [...fullColumns, ...monthColumns], rows: ranked.slice(0, TOP_CUSTOMERS).map(withMonths) },
        { name: "Top 80% Customers", columns: [...fullColumns, ...monthColumns], rows: eighty.map(withMonths) },
        { name: "Principal Concentration", columns: ["Principal", "Sales Value", "% Share", "Customers", "Customers Making 80%", "% of Customers Making 80%", "Top Customer", "Top Customer Sales", "Top Customer %", "Top 10 Share %", "Top 50 Share %"], rows: concentrationRows },
        { name: "Top Customers by Principal", columns: ["Principal", ...RANKING_COLUMNS, ...PROFILE_COLUMNS, ...monthColumns], rows: topByPrincipalRows },
        dimension("Sales by Channel", ["Channel"], (o) => [o.channel]),
        dimension("Sales by Segment", ["Segment"], (o) => [o.segment]),
        dimension("Sales by Territory", ["Region", "Territory"], (o) => [o.region, o.territory]),
        dimension("Sales by Team Leader", ["Outlet Team Leader"], (o) => [o.teamLeader || "Not given"]),
        { name: "Channel by Principal", columns: ["Principal", ...channels, "Total"], rows: matrixRows },
        { name: "Customer Ranking", columns: fullColumns, rows: ranked.map(fullRow) },
      ];
      if (principalRankRows) sheets.push({ name: "Customer Rank by Principal", columns: ["Principal", ...RANKING_COLUMNS, ...PROFILE_COLUMNS], rows: principalRankRows });
      else summary.push([], ["Customer Rank by Principal", `Left out: ${principalRankCount.toLocaleString("en-US")} rows is too many for one workbook. Top Customers by Principal holds the top ${TOP_PER_PRINCIPAL} of each; choose fewer principals or a shorter period for the full ranking.`]);
      const holdsRaw = raw !== null && lines <= options.rawRowLimit;
      if (holdsRaw) {
        sheets.push({
          name: "Raw Data",
          columns: [...RAW_LINE_COLUMNS, ...OUTLET_COLUMNS],
          rows: raw!.map((line) => {
            const customer = lineCustomerKey(splitSfaCustomer(line.sfaName, line.customerName).sfaCustomer);
            return [...rawLineRow(line), ...outletCells(resolver.line(customer, line.principal, line.outletId))];
          }),
        });
      } else {
        summary.push([], ["Raw data", `Not in this workbook: the selection has ${lines.toLocaleString("en-US")} lines, over the ${options.rawRowLimit.toLocaleString("en-US")} a workbook holds here. Use "Raw data (CSV)" for every line, or choose fewer principals or a shorter period.`]);
      }
      // rawRowCount is what the workbook itself carries, so a combined workbook is not trimmed for lines it does not hold.
      return { sheets, rawRowCount: holdsRaw ? lines : 0 };
    },
  };
}
