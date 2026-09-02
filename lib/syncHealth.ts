import { prisma } from "./db";

export interface SyncHealthRow {
  key: string;
  label: string;
  cadenceLabel: string;
  lastUpdated: Date | null;
  staleAfterHours: number;
  isStale: boolean;
  expectedBy: Date | null;
  // Set only for rows with a manual "Trigger now" option (currently just
  // Sales & Returns branches) — the distributor code to queue against via
  // POST /api/sales-returns/trigger. See SalesReturnsTriggerRequest's schema
  // comment for why this has to be a queue rather than a direct call.
  triggerDistributor?: string;
  salesReturnsControl?: {
    desiredMode: string;
    status: string;
    requestedAt: Date | null;
    acknowledgedAt: Date | null;
    resultSummary: string | null;
  };
  eablSalesExport?: {
    latestVpsTransactionDate: Date | null;
    latestAvailableReportDate: Date | null;
    lastDeliveredFile: string | null;
    deliveredLocation: string | null;
    lastError: string | null;
    nextScheduledRunAt: Date | null;
  };
  triggerEablSalesExport?: boolean;
  triggerUpfieldDataEdge?: boolean;
}

/** Surfaces whether each scheduled sync job is actually landing fresh data —
 *  built after SalesDashboard-SalesSync failed silently for 5 days (2026-07-16
 *  to 2026-07-21) while Task Scheduler kept reporting a task existed and every
 *  other part of the app looked fine. A missed run is otherwise invisible
 *  until someone notices stale numbers on a live page. Sales/PL use
 *  `updatedAt` (real upsert-on-conflict tables, bumped on every sync whether
 *  or not values changed); JP Adherence uses `createdAt` since that table is
 *  fully replaced (delete + insert) each run.
 *
 *  Active Outlets/Timestamps use `SyncWatermark.updatedAt` instead of either
 *  data table's own timestamp — since the incremental-sync redesign, a
 *  perfectly healthy hourly run can legitimately touch zero rows (e.g.
 *  overnight, when Pine has no new field-force activity), which would
 *  otherwise look identical to a missed/failed run under the old
 *  data-table-timestamp check. SyncWatermark is bumped on every *successful*
 *  run regardless of whether there was anything new to write, so it's the
 *  correct freshness signal now. PJP ownership adherence joins those
 *  ActiveOutlet owner fields to RepCall, so it shares their source freshness.
 *
 *  Sales & Returns gets one row PER BRANCH (Nairobi/Nyeri). Smart checks can
 *  legitimately find no changed day and skip all data writes, so freshness
 *  comes from a per-distributor SyncWatermark heartbeat updated only after
 *  reconciliation/repair verification succeeds. Existing data createdAt is
 *  retained as a fallback until each machine has completed its first smart
 *  run. A single combined timestamp would let one live branch mask another.
 *  BRANCH_LABELS is just cosmetic — an unrecognized distributor code (e.g.
 *  a new branch onboarded but not added here yet) still shows up, just
 *  labeled by its raw code instead of a friendly name. */
const SALES_RETURNS_BRANCH_LABELS: Record<string, string> = {
  "18048241": "Nairobi",
  "18058585": "Nyeri",
};

export async function getSyncHealth(): Promise<SyncHealthRow[]> {
  const [sales, stock, pl, activeOutletsWatermark, timestampsWatermark, upfieldWatermark, salesReturnsBranches, salesReturnsWatermarks, salesReturnsControls, eablExportStatuses] = await Promise.all([
    prisma.salesRecord.aggregate({ _max: { updatedAt: true } }),
    prisma.stockSyncRun.findFirst({ orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    prisma.pLEntry.aggregate({ _max: { updatedAt: true } }),
    prisma.syncWatermark.findUnique({ where: { bridge: "active-outlets" } }),
    prisma.syncWatermark.findUnique({ where: { bridge: "timestamps" } }),
    prisma.syncWatermark.findUnique({ where: { bridge: "upfield-timestamps" } }),
    prisma.salesReturnLine.groupBy({ by: ["storageLocation"], _max: { createdAt: true } }),
    prisma.syncWatermark.findMany({ where: { bridge: { startsWith: "sales-returns:" } } }),
    prisma.salesReturnsControl.findMany(),
    prisma.eablSalesExportStatus.findMany(),
  ]);

  function row(
    key: string,
    label: string,
    cadenceLabel: string,
    lastUpdated: Date | null,
    staleAfterHours: number,
    triggerDistributor?: string
  ): SyncHealthRow {
    const isStale = !lastUpdated || Date.now() - lastUpdated.getTime() > staleAfterHours * 3600_000;
    const expectedBy = lastUpdated ? new Date(lastUpdated.getTime() + staleAfterHours * 3600_000) : null;
    return { key, label, cadenceLabel, lastUpdated, staleAfterHours, isStale, expectedBy, triggerDistributor };
  }

  const salesReturnsByDistributor = new Map(
    salesReturnsBranches.map((branch) => [branch.storageLocation, branch._max.createdAt] as const)
  );
  const salesReturnsHeartbeatByDistributor = new Map(
    salesReturnsWatermarks.map((watermark) => [watermark.bridge.slice("sales-returns:".length), watermark.updatedAt] as const)
  );
  const salesReturnsControlByDistributor = new Map(salesReturnsControls.map((control) => [control.distributor, control] as const));
  const salesReturnsDistributors = [
    ...Object.keys(SALES_RETURNS_BRANCH_LABELS),
    ...salesReturnsBranches
      .map((branch) => branch.storageLocation)
      .filter((distributor) => !(distributor in SALES_RETURNS_BRANCH_LABELS)),
    ...salesReturnsWatermarks
      .map((watermark) => watermark.bridge.slice("sales-returns:".length))
      .filter((distributor) => !(distributor in SALES_RETURNS_BRANCH_LABELS)),
  ];
  const salesReturnsRows = Array.from(new Set(salesReturnsDistributors))
    .map((distributor) => {
      const control = salesReturnsControlByDistributor.get(distributor);
      return {
        ...row(
        `salesReturns:${distributor}`,
        `Sales & Returns (${SALES_RETURNS_BRANCH_LABELS[distributor] ?? distributor})`,
        control?.desiredMode === "CATCHUP" ? "Every 5 minutes · yesterday + today" : "Every 5 minutes · Smart repair",
        salesReturnsHeartbeatByDistributor.get(distributor) ?? salesReturnsByDistributor.get(distributor) ?? null,
        20 / 60,
        distributor
        ),
        salesReturnsControl: control
          ? {
              desiredMode: control.desiredMode,
              status: control.status,
              requestedAt: control.requestedAt,
              acknowledgedAt: control.acknowledgedAt,
              resultSummary: control.resultSummary,
            }
          : undefined,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const eabl = eablExportStatuses.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  const eablRow: SyncHealthRow = {
    ...row("eablSalesExport", "EABL Sales Export Download", "Every 5 minutes · yesterday + today", eabl?.lastSuccessfulDownloadAt ?? null, 20 / 60),
    triggerEablSalesExport: true,
    eablSalesExport: eabl ? {
      latestVpsTransactionDate: eabl.latestVpsTransactionDate,
      latestAvailableReportDate: eabl.latestAvailableReportDate,
      lastDeliveredFile: eabl.lastDeliveredFile,
      deliveredLocation: eabl.deliveredLocation,
      lastError: eabl.lastError,
      nextScheduledRunAt: eabl.nextScheduledRunAt,
    } : undefined,
  };

  return [
    row("sales", "Sales (SAP)", "Every 30 minutes", sales._max.updatedAt, 90 / 60),
    row("stock", "Stock (SAP direct, parallel)", "Hourly", stock?.completedAt ?? null, 2),
    row("pl", "P&L (SAP)", "Twice daily", pl._max.updatedAt, 18),
    row("activeOutlets", "Active Outlets (Pine)", "Hourly (incremental; full resync ~daily)", activeOutletsWatermark?.updatedAt ?? null, 3),
    row("timestamps", "Timestamps (Pine)", "Every 5 minutes (rolling 2-day window)", timestampsWatermark?.updatedAt ?? null, 20 / 60),
    {
      ...row("upfieldTimestamps", "Timestamp & Coverage (Upfield DataEdge)", "Every 5 minutes", upfieldWatermark?.updatedAt ?? null, 20 / 60),
      triggerUpfieldDataEdge: true,
    },
    row("jpAdherence", "PJP Ownership Adherence (Pine)", "Active Outlets hourly + Timestamps every 5 minutes", activeOutletsWatermark?.updatedAt ?? null, 3),
    ...salesReturnsRows,
    eablRow,
  ];
}
