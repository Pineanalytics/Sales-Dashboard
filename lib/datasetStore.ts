import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "./db";
import { normalizePrincipalKey } from "./normalize";
import { encodeDataset, decodeDataset } from "./snapshotCodec";
import { CANONICAL_MONTHS } from "./timeIntelligence";
import type { Dataset, DatasetSnapshotSummary, MonthlyCoverageRow, MonthlyPLRow, MonthlySalesRow, PLLineType } from "./types";

// getLatestSnapshot() composes four separate queries (the Snapshot row itself —
// which carries a multi-MB JSON blob — plus full SalesRecord/Target/PLEntry scans)
// and used to re-run all of them, uncached, on every single page load AND on the
// client's own /api/dataset poll (route-change + 3-minute interval). Under any DB
// load that alone was enough to make every page feel slow, independent of anything
// module-specific. The underlying data only actually changes when one of the four
// mutation paths below runs (a rare, manual/scheduled event) — a 5-minute cache
// with on-demand invalidation removes the redundant work without sacrificing
// freshness in practice. See invalidateDatasetCache().
const DATASET_CACHE_TAG = "dataset";

export async function saveSnapshot(dataset: Dataset): Promise<DatasetSnapshotSummary> {
  const snapshot = await prisma.snapshot.create({
    data: {
      uploadedAt: new Date(dataset.uploadedAt),
      reportTitle: dataset.reportMeta.title || "Untitled Report",
      data: encodeDataset(dataset),
    },
  });
  return {
    id: snapshot.id,
    uploadedAt: snapshot.uploadedAt.toISOString(),
    reportTitle: snapshot.reportTitle,
  };
}

/** Merges scripts/db-bridge-sourced Sales rows (SAP SQL Server, via
 *  app/api/sales/upload) onto dataset.monthlySales, keyed by (year, month,
 *  principal). Unlike overlayPL, this is a MERGE not a full replace — the SAP
 *  bridge only fetches the current calendar year (see queries/ytdRaw.ts), so
 *  prior-year Excel-sourced rows (needed for YoY comparisons) must survive
 *  untouched. A DB row replaces the matching Excel row's revenue/cogs/
 *  grossProfit/location wholesale (its target is preserved and re-merged by
 *  overlayTargets afterward); a DB row with no Excel counterpart (a new
 *  principal/month combo) is appended as a new row with target: null. Runs
 *  BEFORE overlayTargets so the target merge operates on the final sales rows. */
async function overlaySales(dataset: Dataset): Promise<Dataset> {
  const records = await prisma.salesRecord.findMany();
  if (records.length === 0) return dataset;

  const byKey = new Map(records.map((r) => [`${r.year}|${r.month}|${r.principal}`, r]));
  const matchedKeys = new Set<string>();

  const merged: MonthlySalesRow[] = dataset.monthlySales.map((row) => {
    const key = `${row.year}|${row.month}|${row.principal}`;
    const record = byKey.get(key);
    if (!record) return row;
    matchedKeys.add(key);
    return {
      ...row,
      location: record.location,
      revenue: record.revenue,
      cogs: record.cogs,
      grossProfit: record.grossProfit,
      grossMarginPct: record.revenue > 0 ? Math.round((record.grossProfit / record.revenue) * 1000) / 10 : null,
    };
  });

  for (const record of records) {
    const key = `${record.year}|${record.month}|${record.principal}`;
    if (matchedKeys.has(key)) continue;
    merged.push({
      year: record.year,
      month: record.month,
      monthIndex: record.monthIndex,
      location: record.location,
      principal: record.principal,
      principalKey: normalizePrincipalKey(record.principal),
      revenue: record.revenue,
      target: null,
      cogs: record.cogs,
      grossProfit: record.grossProfit,
      grossMarginPct: record.revenue > 0 ? Math.round((record.grossProfit / record.revenue) * 1000) / 10 : null,
    });
  }

  return { ...dataset, monthlySales: merged };
}

/** Merges the JP Adherence bridge's already-computed monthly rollup
 *  (JPMonthlySplitRow — synced twice daily straight from Pine) onto
 *  dataset.monthlyCoverage, instead of Coverage & Productivity needing its
 *  own separate Pine SQL bridge. JPMonthlySplitRow tracks Active/Inactive
 *  outlets as separate rows for the same (month, Cost Centre, role, rep) —
 *  summed here first, since MonthlyCoverageRow has no activityStatus split
 *  of its own and productivityPct must be recomputed from the summed
 *  coverage/productive (never averaged — same distinct-outlet-weighted
 *  principle used everywhere else in this codebase, avoiding the "average of
 *  ratios" distortion). JPMonthlySplitRow only covers a rolling ~90-day
 *  window (see its own schema comment), so this is a MERGE like overlaySales,
 *  not a full replace — older Excel-sourced months are left untouched.
 *  Matches on principalKey (normalized brand), not the raw principal string,
 *  since Pine's Cost Centre names and the Excel Coverage sheet's "Principal"
 *  column aren't guaranteed to use identical text — normalizePrincipalKey()
 *  is the whole point of that function existing. Bridge coverage is known to
 *  read higher than the old Excel figures (non-retroactive per-month
 *  counting vs. whatever the Excel pivot did) — see project notes; that's
 *  the intended, going-forward number now. */
async function overlayCoverage(dataset: Dataset): Promise<Dataset> {
  const splitRows = await prisma.jPMonthlySplitRow.findMany();
  if (splitRows.length === 0) return dataset;

  interface Agg {
    year: string;
    monthIndex: number;
    principalKey: string;
    principal: string;
    salesRole: string;
    employeeName: string;
    coverage: number;
    productiveCalls: number;
  }
  const byKey = new Map<string, Agg>();
  for (const r of splitRows) {
    const principalKey = normalizePrincipalKey(r.costCentre);
    const key = `${r.year}|${r.monthIndex}|${principalKey}|${r.employeeName}|${r.salesRole}`;
    const agg = byKey.get(key);
    if (agg) {
      agg.coverage += r.coverage;
      agg.productiveCalls += r.productive;
    } else {
      byKey.set(key, {
        year: r.year,
        monthIndex: r.monthIndex,
        principalKey,
        principal: r.costCentre,
        salesRole: r.salesRole,
        employeeName: r.employeeName,
        coverage: r.coverage,
        productiveCalls: r.productive,
      });
    }
  }

  const matchedKeys = new Set<string>();
  const merged: MonthlyCoverageRow[] = dataset.monthlyCoverage.map((row) => {
    const key = `${row.year}|${row.monthIndex}|${row.principalKey}|${row.employeeName}|${row.salesRole}`;
    const agg = byKey.get(key);
    if (!agg) return row;
    matchedKeys.add(key);
    return {
      ...row,
      coverage: agg.coverage,
      productiveCalls: agg.productiveCalls,
      productivityPct: agg.coverage > 0 ? Math.round((agg.productiveCalls / agg.coverage) * 1000) / 10 : 0,
    };
  });

  for (const [key, agg] of byKey) {
    if (matchedKeys.has(key)) continue;
    merged.push({
      year: agg.year,
      month: CANONICAL_MONTHS[agg.monthIndex] ?? "",
      monthIndex: agg.monthIndex,
      salesRole: agg.salesRole,
      employeeName: agg.employeeName,
      principal: agg.principal,
      principalKey: agg.principalKey,
      coverage: agg.coverage,
      productiveCalls: agg.productiveCalls,
      productivityPct: agg.coverage > 0 ? Math.round((agg.productiveCalls / agg.coverage) * 1000) / 10 : 0,
    });
  }

  return { ...dataset, monthlyCoverage: merged };
}

/** Overlays admin-uploaded Target rows onto monthlySales[].target, keyed by
 *  (year, month, principal). A DB row only wins when it exists AND has a
 *  non-null valueTarget — a Target row that only captured e.g. Volume Target
 *  that month falls through to whatever the Snapshot already had, rather than
 *  nulling out a perfectly good value. */
async function overlayTargets(dataset: Dataset): Promise<Dataset> {
  const targets = await prisma.target.findMany();
  if (targets.length === 0) return dataset;

  const byKey = new Map(targets.map((t) => [`${t.year}|${t.month}|${t.principal}`, t.valueTarget]));

  return {
    ...dataset,
    monthlySales: dataset.monthlySales.map((row) => {
      const dbTarget = byKey.get(`${row.year}|${row.month}|${row.principal}`);
      return dbTarget !== undefined && dbTarget !== null ? { ...row, target: dbTarget } : row;
    }),
  };
}

/** Attaches admin/pl-bridge-sourced P&L rows as dataset.monthlyPL. Unlike targets,
 *  there's nothing to fall back to — the Excel upload path never produces P&L data,
 *  so this always fully replaces whatever monthlyPL the Snapshot happened to have. */
async function overlayPL(dataset: Dataset): Promise<Dataset> {
  const rows = await prisma.pLEntry.findMany();
  const monthlyPL: MonthlyPLRow[] = rows.map((r) => ({
    year: r.year,
    month: r.month,
    monthIndex: r.monthIndex,
    principal: r.principal,
    principalKey: normalizePrincipalKey(r.principal),
    accountCode: r.accountCode,
    accountName: r.accountName,
    lineType: r.lineType as PLLineType,
    amount: r.amount,
  }));
  return { ...dataset, monthlyPL };
}

async function overlayAdminData(dataset: Dataset): Promise<Dataset> {
  // overlaySales must run before overlayTargets — it can replace/append
  // monthlySales rows, and overlayTargets's merge needs to see the final set.
  const withSales = await overlaySales(dataset);
  const [withTargets, withPL, withCoverage] = await Promise.all([
    overlayTargets(withSales),
    overlayPL(dataset),
    overlayCoverage(dataset),
  ]);
  return { ...withTargets, monthlyPL: withPL.monthlyPL, monthlyCoverage: withCoverage.monthlyCoverage };
}

async function loadLatestSnapshot(): Promise<Dataset | null> {
  const snapshot = await prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" } });
  if (!snapshot) return null;
  return overlayAdminData(decodeDataset(snapshot.data));
}

export const getLatestSnapshot = unstable_cache(loadLatestSnapshot, ["latest-snapshot"], {
  tags: [DATASET_CACHE_TAG],
  revalidate: 300, // safety-net TTL — normal path is the explicit invalidateDatasetCache() below
});

/** Called by every route that writes Snapshot/SalesRecord/Target/PLEntry data —
 *  Excel upload, the SAP/PL bridge syncs, and Target CRUD/upload — so the next
 *  getLatestSnapshot() call reflects the change immediately instead of waiting
 *  out the 5-minute TTL. */
export function invalidateDatasetCache() {
  // Next.js 16's revalidateTag() requires a cache-life profile as its 2nd arg (used
  // by its newer "use cache" system) even though this tag is written by the classic
  // unstable_cache() above — an empty profile is the documented no-op default.
  revalidateTag(DATASET_CACHE_TAG, {});
}

export async function getSnapshotById(id: string): Promise<Dataset | null> {
  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) return null;
  return overlayAdminData(decodeDataset(snapshot.data));
}

export async function listSnapshots(limit = 20): Promise<DatasetSnapshotSummary[]> {
  const snapshots = await prisma.snapshot.findMany({
    orderBy: { uploadedAt: "desc" },
    take: limit,
    select: { id: true, uploadedAt: true, reportTitle: true },
  });
  return snapshots.map((s) => ({
    id: s.id,
    uploadedAt: s.uploadedAt.toISOString(),
    reportTitle: s.reportTitle,
  }));
}
