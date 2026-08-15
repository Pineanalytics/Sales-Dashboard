import { prisma } from "./db";

export interface SyncHealthRow {
  key: string;
  label: string;
  cadenceLabel: string;
  lastUpdated: Date | null;
  staleAfterHours: number;
  isStale: boolean;
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
 *  ActiveOutlet owner fields to RepCall, so it shares their source freshness. */
export async function getSyncHealth(): Promise<SyncHealthRow[]> {
  const [sales, stock, pl, activeOutletsWatermark, timestampsWatermark] = await Promise.all([
    prisma.salesRecord.aggregate({ _max: { updatedAt: true } }),
    prisma.stockSyncRun.findFirst({ orderBy: { completedAt: "desc" }, select: { completedAt: true } }),
    prisma.pLEntry.aggregate({ _max: { updatedAt: true } }),
    prisma.syncWatermark.findUnique({ where: { bridge: "active-outlets" } }),
    prisma.syncWatermark.findUnique({ where: { bridge: "timestamps" } }),
  ]);

  function row(key: string, label: string, cadenceLabel: string, lastUpdated: Date | null, staleAfterHours: number): SyncHealthRow {
    const isStale = !lastUpdated || Date.now() - lastUpdated.getTime() > staleAfterHours * 3600_000;
    return { key, label, cadenceLabel, lastUpdated, staleAfterHours, isStale };
  }

  return [
    row("sales", "Sales (SAP)", "Every 30 minutes", sales._max.updatedAt, 90 / 60),
    row("stock", "Stock (SAP direct, parallel)", "Hourly", stock?.completedAt ?? null, 2),
    row("pl", "P&L (SAP)", "Twice daily", pl._max.updatedAt, 18),
    row("activeOutlets", "Active Outlets (Pine)", "Hourly (incremental; full resync ~daily)", activeOutletsWatermark?.updatedAt ?? null, 3),
    row("timestamps", "Timestamps (Pine)", "Every 5 minutes (rolling 2-day window)", timestampsWatermark?.updatedAt ?? null, 20 / 60),
    row("jpAdherence", "PJP Ownership Adherence (Pine)", "Active Outlets hourly + Timestamps every 5 minutes", activeOutletsWatermark?.updatedAt ?? null, 3),
  ];
}
