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
 *  until someone notices stale numbers on a live page. Sales/PL/Active
 *  Outlets use `updatedAt` (real upsert-on-conflict tables, bumped on every
 *  sync whether or not values changed); JP Adherence/Timestamps use
 *  `createdAt` since those tables are fully replaced (delete + insert) each
 *  run, so createdAt is an equally reliable proxy for "last sync time." */
export async function getSyncHealth(): Promise<SyncHealthRow[]> {
  const [sales, pl, activeOutlets, timestamps, jpAdherence] = await Promise.all([
    prisma.salesRecord.aggregate({ _max: { updatedAt: true } }),
    prisma.pLEntry.aggregate({ _max: { updatedAt: true } }),
    prisma.activeOutlet.aggregate({ _max: { updatedAt: true } }),
    prisma.repCall.aggregate({ _max: { createdAt: true } }),
    prisma.journeyPlanRow.aggregate({ _max: { createdAt: true } }),
  ]);

  function row(key: string, label: string, cadenceLabel: string, lastUpdated: Date | null, staleAfterHours: number): SyncHealthRow {
    const isStale = !lastUpdated || Date.now() - lastUpdated.getTime() > staleAfterHours * 3600_000;
    return { key, label, cadenceLabel, lastUpdated, staleAfterHours, isStale };
  }

  return [
    row("sales", "Sales (SAP)", "Twice daily, 06:30 & 17:30", sales._max.updatedAt, 18),
    row("pl", "P&L (SAP)", "Twice daily", pl._max.updatedAt, 18),
    row("activeOutlets", "Active Outlets (Pine)", "Hourly", activeOutlets._max.updatedAt, 3),
    row("timestamps", "Timestamps (Pine)", "Hourly", timestamps._max.createdAt, 3),
    row("jpAdherence", "JP Adherence (Pine)", "Twice daily, 08:00 & 19:00", jpAdherence._max.createdAt, 18),
  ];
}
