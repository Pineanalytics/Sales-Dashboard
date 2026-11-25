// Shapes for the Credit Notes & Returns module. The figures come from the SAP
// document lines the Performance Analysis job stores (PerformanceLine): every
// invoice and credit-note line, kept at Month x customer x item x warehouse x
// rep grain with its brand-level principal. Credit notes are the money given
// back to customers (returns, price corrections, damages); the module reports
// them as positive magnitudes and sets them against the invoiced value so a
// rate ("credit notes as % of invoiced") can be read at every level.

export interface CreditNoteTotals {
  /** Credit notes issued, as a positive magnitude (excl. VAT). */
  credit: number;
  /** Invoiced value of the same slice, before credit notes. */
  invoiced: number;
  /** Credit notes as a percentage of invoiced; null when nothing was invoiced. */
  cnPct: number | null;
  /** Cases credited back (positive). */
  cases: number;
  /** Gross profit given up by the credit notes (positive). */
  gpLost: number;
  /** Credit-note lines. */
  creditLines: number;
}

export interface CreditNoteKpi extends CreditNoteTotals {
  /** Net sales: invoiced less credit notes. */
  net: number;
  customers: number;
  items: number;
  reps: number;
  principals: number;
  /** Credit per affected customer. */
  avgPerCustomer: number | null;
  /** Credit notes of the equal-length period just before, null when the stored lines do not cover it. */
  priorCredit: number | null;
  /** Percentage change of credit against that period; null when it is unavailable or was zero. */
  creditChangePct: number | null;
  priorCnPct: number | null;
  /** Percentage points the rate moved (this period less the prior one). */
  cnPctChange: number | null;
  /** Share of credit notes carried by the ten largest customers. */
  top10CustomerShare: number | null;
  /** Items whose credit notes exceed what was invoiced in the period. */
  itemsCreditedAboveInvoiced: number;
}

export interface CreditMonthRow {
  /** YYYY-MM */
  m: string;
  /** Whether the month is part of the selected period (earlier months give context). */
  inScope: boolean;
  credit: number;
  invoiced: number;
  cnPct: number | null;
  cases: number;
  customers: number;
  creditLines: number;
}

export interface CreditPrincipalRow extends CreditNoteTotals {
  p: string;
  share: number;
  customers: number;
  items: number;
  priorCredit: number | null;
  changePct: number | null;
  /** Credit per month, aligned to the payload's `months`. */
  m: number[];
}

export interface CreditItemRow extends CreditNoteTotals {
  code: string;
  name: string;
  p: string;
  share: number;
  customers: number;
  priorCredit: number | null;
  changePct: number | null;
}

export interface CreditCustomerRow extends CreditNoteTotals {
  rank: number;
  code: string;
  name: string;
  /** The rep carrying most of the customer's credit notes. */
  rep: string;
  share: number;
  /** Running share down the ranking. */
  cum: number;
  items: number;
  principals: number;
  priorCredit: number | null;
  changePct: number | null;
}

export interface CreditRepRow extends CreditNoteTotals {
  n: string;
  share: number;
  customers: number;
  items: number;
  /** The principal carrying most of the rep's credit notes. */
  principal: string;
  priorCredit: number | null;
  changePct: number | null;
}

export interface CreditWarehouseRow extends CreditNoteTotals {
  n: string;
  share: number;
  customers: number;
}

export interface CreditLineRow {
  month: string;
  customerCode: string;
  customerName: string;
  itemCode: string;
  itemName: string;
  principal: string;
  rep: string;
  warehouse: string;
  cases: number;
  credit: number;
  gpLost: number;
}

export interface CreditNotesPayload {
  /** Nairobi calendar date of the SAP read, YYYY-MM-DD. */
  asOf: string;
  /** Months the trend spans (up to twelve, ending with the period's last month). */
  months: string[];
  /** The months of the selected period; every total, ranking and share is over these. */
  scope: string[];
  /** The equal-length window before the period, used for the comparison; empty when not covered. */
  priorScope: string[];
  /** True when the period's last month is still in progress. */
  mtd: boolean;
  kpi: CreditNoteKpi;
  monthly: CreditMonthRow[];
  principals: CreditPrincipalRow[];
  items: CreditItemRow[];
  customers: CreditCustomerRow[];
  reps: CreditRepRow[];
  warehouses: CreditWarehouseRow[];
  /** The largest individual credit-note lines of the period. */
  topLines: CreditLineRow[];
  /** Counts before the lists are cut to their display size. */
  itemCount: number;
  customerCount: number;
  /** Plain-language findings, most important first. */
  insights: string[];
}

/** Facts about the stored SAP lines, shown in the page footer. */
export interface CreditNotesMeta {
  year: number;
  generatedAt: string;
  asOf: string;
  lineCount: number;
}

/** What /api/credit-notes returns. */
export interface CreditNotesResponse {
  meta: CreditNotesMeta | null;
  /** Null when no SAP lines exist yet, or none match the selection. */
  report: CreditNotesPayload | null;
  /** True when the account is limited to a team or principals and the figures are cut to that scope. */
  scoped: boolean;
}
