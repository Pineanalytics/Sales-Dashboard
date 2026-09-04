export const DEFAULT_UKL_EXPORT_RECONCILE_DAYS = 35;
export const MAX_UKL_EXPORT_RECONCILE_DAYS = 62;

export interface UklExportManifestAggregate {
  date: string;
  rowCount: bigint | number;
  lastReplacedAt: Date;
  contentHash: string;
}

export interface UklExportManifestDay {
  date: string;
  rowCount: number;
  lastReplacedAt: string;
  revision: string;
}

export interface UklExportManifestRange {
  start: Date;
  endExclusive: Date;
  dayCount: number;
}

export function parseUklExportManifestRange(from: string | null, to: string | null): UklExportManifestRange | null {
  if (!from && !to) return null;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== from ||
    end.toISOString().slice(0, 10) !== to ||
    end < start
  ) return null;
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (dayCount > MAX_UKL_EXPORT_RECONCILE_DAYS) return null;
  return { start, endExclusive: new Date(end.getTime() + 86_400_000), dayCount };
}

export function parseUklExportReconcileDays(value: string | null): number | null {
  if (value === null || value === "") return DEFAULT_UKL_EXPORT_RECONCILE_DAYS;
  if (!/^\d+$/.test(value)) return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 2 && days <= MAX_UKL_EXPORT_RECONCILE_DAYS ? days : null;
}

/** The revision tracks exported content, not ingestion time. The Centegy
 * bridge can replace yesterday and today every five minutes even when values
 * are unchanged; using createdAt made yesterday look perpetually stale and
 * prevented the puller from advancing to today. */
export function toUklExportManifestDay(row: UklExportManifestAggregate): UklExportManifestDay {
  const rowCount = Number(row.rowCount);
  const lastReplacedAt = row.lastReplacedAt.toISOString();
  return {
    date: row.date,
    rowCount,
    lastReplacedAt,
    revision: `${row.date}:${rowCount}:${row.contentHash}`,
  };
}
