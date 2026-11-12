// The jobs the continuous sync workers run (scripts/continuous-sync-worker.ts), shared with the
// app so Admin > Data & sync can offer a "Refresh now" for each one. Pure data: no database,
// so the worker and the browser can both import it.

export const SYNC_JOB_NAMES = [
  "timestamps",
  "coverage",
  "eabl",
  "eabl-customers",
  "active-outlets",
  "order-360",
  "mars-kpis",
  "sales",
  "sfa-sales",
  "purchases",
  "performance",
  "pl",
  "stock",
  "receivables",
  "sap-reps",
  "pine-reps",
  "rep-directory",
] as const;

export type SyncJobName = (typeof SYNC_JOB_NAMES)[number];

export interface SyncJobInfo {
  label: string;
  /** Shown in a confirmation before a manual run: the job reads a lot and loads the shared server. */
  heavyWarning?: string;
}

export const SYNC_JOB_INFO: Record<SyncJobName, SyncJobInfo> = {
  timestamps: { label: "Timestamps (Pine)" },
  coverage: { label: "Coverage & Productivity (Pine)" },
  eabl: { label: "EABL call performance" },
  "eabl-customers": { label: "EABL customer master" },
  "active-outlets": { label: "Active Outlets (Pine)" },
  "order-360": { label: "Order 360 (Pine)" },
  "mars-kpis": { label: "Mars KPIs (Pine)", heavyWarning: "A Mars KPI pass takes one to three minutes of CPU on the shared server." },
  sales: { label: "Sales (SAP)" },
  "sfa-sales": { label: "SFA-outlet sales (SAP)" },
  purchases: { label: "Stock receipts / Purchases (SAP)" },
  performance: { label: "Performance Analysis (SAP)", heavyWarning: "This reads the whole year of SAP document lines (about 575,000) and can take several minutes." },
  pl: { label: "P&L (SAP)" },
  stock: { label: "Stock (SAP)" },
  receivables: { label: "Receivables (SAP)" },
  "sap-reps": { label: "Rep directory: SAP salespeople" },
  "pine-reps": { label: "Rep directory: Pine users" },
  "rep-directory": { label: "Rep directory: Leverage, DataEdge, EABL" },
};

export function isSyncJobName(value: unknown): value is SyncJobName {
  return typeof value === "string" && (SYNC_JOB_NAMES as readonly string[]).includes(value);
}

/** The jobs that have no row of their own in Sync Health (their data tables have no usable freshness
 *  column), so the panel adds one for them from the worker's own run record. */
export const SYNC_JOBS_WITHOUT_HEALTH_ROW: readonly SyncJobName[] = ["sfa-sales", "purchases", "coverage", "mars-kpis", "eabl", "eabl-customers", "performance", "sap-reps", "pine-reps", "rep-directory"];

export type SyncRunState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
