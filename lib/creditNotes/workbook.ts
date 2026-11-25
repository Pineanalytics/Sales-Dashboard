// The Credit Notes & Returns report as Excel sheets: one cover sheet and one flat, filterable sheet per
// dimension, built from the same payload the page shows (with the item and customer lists uncut).
import type { ExtractCell, ExtractSheet } from "@/lib/brandCustomerExtract";
import type { CreditNotesMeta, CreditNotesPayload } from "./types";

export interface CreditNotesWorkbookScope {
  periodLabel: string;
  principalLabel: string;
  /** What was typed in the page's search box, if anything. */
  query: string;
  generatedAt: Date;
  /** True when the figures are cut to the viewer's own team or principals. */
  scoped: boolean;
}

const round = (value: number | null, places = 2): ExtractCell => (value === null || !Number.isFinite(value) ? "" : Math.round(value * 10 ** places) / 10 ** places);

function utcStamp(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function buildCreditNotesSheets(report: CreditNotesPayload, meta: CreditNotesMeta | null, scope: CreditNotesWorkbookScope): ExtractSheet[] {
  const { kpi } = report;
  const summary: ExtractSheet = {
    name: "Summary",
    columns: ["Measure", "Value"],
    rows: [
      ["Period", scope.periodLabel],
      ["Principals", scope.principalLabel],
      ["Search filter", scope.query || "None"],
      ["Scope", scope.scoped ? "Limited to your team or principals" : "All"],
      ["SAP read as of", report.asOf],
      ["Generated", utcStamp(scope.generatedAt)],
      ["", ""],
      ["Credit Notes (KES)", round(kpi.credit)],
      ["Invoiced (KES)", round(kpi.invoiced)],
      ["Net Sales (KES)", round(kpi.net)],
      ["Credit Notes % of invoiced", round(kpi.cnPct)],
      ["Cases credited", round(kpi.cases, 1)],
      ["Gross profit given up (KES)", round(kpi.gpLost)],
      ["Credit-note lines", kpi.creditLines],
      ["Customers credited", kpi.customers],
      ["Items credited", kpi.items],
      ["Reps involved", kpi.reps],
      ["Credit per customer (KES)", round(kpi.avgPerCustomer)],
      ["Prior period credit notes (KES)", round(kpi.priorCredit)],
      ["Change on prior period %", round(kpi.creditChangePct)],
      ["Share of the ten largest customers %", round(kpi.top10CustomerShare)],
      ["", ""],
      ...report.insights.map((text, index): ExtractCell[] => [index === 0 ? "What stands out" : "", text.replace(/\*\*/g, "")]),
      ["", ""],
      ["Source", "SAP Business One invoices and credit notes (net of VAT). Credit notes are shown as positive amounts and set against invoiced value."],
      ...(meta ? [["Lines stored for the year", meta.lineCount] as ExtractCell[]] : []),
    ],
  };

  const monthly: ExtractSheet = {
    name: "Monthly",
    columns: ["Month", "In Period", "Credit Notes", "Invoiced", "Credit Notes %", "Cases Credited", "Customers Credited", "Credit Lines"],
    rows: report.monthly.map((row) => [row.m, row.inScope ? "Yes" : "", round(row.credit), round(row.invoiced), round(row.cnPct), round(row.cases, 1), row.customers, row.creditLines]),
  };

  const principals: ExtractSheet = {
    name: "Principals",
    columns: ["Principal", "Credit Notes", "Share Of Credit %", "Invoiced", "Credit Notes %", "Cases Credited", "Customers Credited", "Items Credited", "Prior Period Credit Notes", "Change %", "GP Lost"],
    rows: report.principals.map((row) => [row.p, round(row.credit), round(row.share), round(row.invoiced), round(row.cnPct), round(row.cases, 1), row.customers, row.items, round(row.priorCredit), round(row.changePct), round(row.gpLost)]),
  };

  const items: ExtractSheet = {
    name: "Items",
    columns: ["Item Code", "Item", "Principal", "Credit Notes", "Share Of Credit %", "Invoiced", "Credit Notes %", "Cases Credited", "Customers Credited", "Prior Period Credit Notes", "Change %", "GP Lost"],
    rows: report.items.map((row) => [row.code, row.name, row.p, round(row.credit), round(row.share), round(row.invoiced), round(row.cnPct), round(row.cases, 1), row.customers, round(row.priorCredit), round(row.changePct), round(row.gpLost)]),
  };

  const customers: ExtractSheet = {
    name: "Customers",
    columns: ["Rank", "Customer Code", "Customer", "Main Rep", "Credit Notes", "Share Of Credit %", "Cumulative Share %", "Invoiced", "Credit Notes %", "Cases Credited", "Items Credited", "Principals", "Prior Period Credit Notes", "Change %", "GP Lost"],
    rows: report.customers.map((row) => [row.rank, row.code, row.name, row.rep, round(row.credit), round(row.share), round(row.cum), round(row.invoiced), round(row.cnPct), round(row.cases, 1), row.items, row.principals, round(row.priorCredit), round(row.changePct), round(row.gpLost)]),
  };

  const reps: ExtractSheet = {
    name: "Sales Reps",
    columns: ["Rep", "Main Principal", "Credit Notes", "Share Of Credit %", "Invoiced", "Credit Notes %", "Cases Credited", "Customers Credited", "Items Credited", "Prior Period Credit Notes", "Change %", "GP Lost"],
    rows: report.reps.map((row) => [row.n, row.principal, round(row.credit), round(row.share), round(row.invoiced), round(row.cnPct), round(row.cases, 1), row.customers, row.items, round(row.priorCredit), round(row.changePct), round(row.gpLost)]),
  };

  const warehouses: ExtractSheet = {
    name: "Branches",
    columns: ["Branch", "Credit Notes", "Share Of Credit %", "Invoiced", "Credit Notes %", "Cases Credited", "Customers Credited"],
    rows: report.warehouses.map((row) => [row.n, round(row.credit), round(row.share), round(row.invoiced), round(row.cnPct), round(row.cases, 1), row.customers]),
  };

  const lines: ExtractSheet = {
    name: "Largest Credit Lines",
    columns: ["Month", "Customer Code", "Customer", "Item Code", "Item", "Principal", "Rep", "Branch", "Cases Credited", "Credit Notes", "GP Lost"],
    rows: report.topLines.map((row) => [row.month, row.customerCode, row.customerName, row.itemCode, row.itemName, row.principal, row.rep, row.warehouse, round(row.cases, 1), round(row.credit), round(row.gpLost)]),
  };

  return [summary, monthly, principals, items, customers, reps, warehouses, lines];
}
