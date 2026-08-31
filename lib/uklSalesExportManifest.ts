export const DEFAULT_UKL_EXPORT_RECONCILE_DAYS = 35;
export const MAX_UKL_EXPORT_RECONCILE_DAYS = 62;

export interface UklExportManifestAggregate {
  date: string;
  rowCount: bigint | number;
  lastReplacedAt: Date;
}

export interface UklExportManifestDay {
  date: string;
  rowCount: number;
  lastReplacedAt: string;
  revision: string;
}

export function parseUklExportReconcileDays(value: string | null): number | null {
  if (value === null || value === "") return DEFAULT_UKL_EXPORT_RECONCILE_DAYS;
  if (!/^\d+$/.test(value)) return null;
  const days = Number(value);
  return Number.isInteger(days) && days >= 2 && days <= MAX_UKL_EXPORT_RECONCILE_DAYS ? days : null;
}

/** `createdAt` changes whenever a branch/day is atomically replaced by the
 * Centegy bridge. Combining it with row count gives the remote puller a small,
 * non-sensitive version token without hashing or downloading the full CSV. */
export function toUklExportManifestDay(row: UklExportManifestAggregate): UklExportManifestDay {
  const rowCount = Number(row.rowCount);
  const lastReplacedAt = row.lastReplacedAt.toISOString();
  return {
    date: row.date,
    rowCount,
    lastReplacedAt,
    revision: `${row.date}:${rowCount}:${lastReplacedAt}`,
  };
}
