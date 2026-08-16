import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "./db";
import { normalizePrincipalKey } from "./normalize";
import { encodeDataset, decodeDataset } from "./snapshotCodec";
import { CANONICAL_MONTHS } from "./timeIntelligence";
import { weightedCoverDays, stockStatus } from "./parseWorkbook";
import { getMonthlyCoverageRollup } from "./jpAdherence";
import type { Dataset, DatasetSnapshotSummary, MonthlyBrandCustomerRow, MonthlyCoverageRow, MonthlyCoverageTargetRow, MonthlyPLRow, MonthlySalesRow, PLLineType, StockItem, StockTotal } from "./types";

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

/** Merges lib/jpAdherence.ts's live RepCall-derived monthly coverage rollup
 *  onto dataset.monthlyCoverage, instead of Coverage & Productivity needing
 *  its own separate Pine SQL bridge (the old JPMonthlySplitRow, synced twice
 *  daily straight from Pine, has been retired — JP Adherence itself now reads
 *  RepCall directly rather than a redundant second Pine fetch). The rollup
 *  tracks Active/Inactive as separate rows for the same (month, principal,
 *  role, rep) — summed here first, since MonthlyCoverageRow has no
 *  activityStatus split of its own and productivityPct must be recomputed
 *  from the summed coverage/productive (never averaged — same distinct-
 *  outlet-weighted principle used everywhere else in this codebase, avoiding
 *  the "average of ratios" distortion). The rollup only covers RepCall's own
 *  3-trailing-month retention, so this is a MERGE like overlaySales, not a
 *  full replace — older Excel-sourced months are left untouched. Bridge
 *  coverage is known to read higher than the old Excel figures (non-
 *  retroactive per-month counting vs. whatever the Excel pivot did) — see
 *  project notes; that's the intended, going-forward number now. */
async function overlayCoverage(dataset: Dataset): Promise<Dataset> {
  const rollupRows = await getMonthlyCoverageRollup(null);
  if (rollupRows.length === 0) return dataset;

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
  for (const r of rollupRows) {
    const key = `${r.year}|${r.monthIndex}|${r.principalKey}|${r.employeeName}|${r.salesRole}`;
    const agg = byKey.get(key);
    if (agg) {
      agg.coverage += r.coverage;
      agg.productiveCalls += r.productive;
    } else {
      byKey.set(key, {
        year: r.year,
        monthIndex: r.monthIndex,
        principalKey: r.principalKey,
        principal: r.principal,
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

/** Merges scripts/db-bridge-sourced Brand&Customer rows (SAP SQL Server, via
 *  app/api/sales/upload-brand-customer) onto dataset.monthlyBrandCustomer,
 *  replacing the Excel-sourced "Brand&Customer Listing" sheet for the current
 *  calendar year — same MERGE-not-replace pattern as overlaySales (ytdRaw only
 *  covers the current year, so prior-year Excel rows must survive untouched).
 *  Matches lib/parseWorkbook.ts's own convention: completed months of the
 *  current year come from BrandCustomerActual's monthly aggregate (a 1st-of-
 *  month placeholder date, same as historical Excel rows), while the CURRENT
 *  month comes from DailyBrandCustomerActual's real per-day rows instead —
 *  never both, to avoid double-counting the same month at two granularities.
 *  Keyed to the live product grain: date|principalKey|brand|salesEmployee|
 *  customerName. When live SAP data exists for a customer/day, the older
 *  spreadsheet aggregate is replaced in full so it cannot be counted twice. */
async function overlayBrandCustomer(dataset: Dataset): Promise<Dataset> {
  const now = new Date();
  const currentYear = String(now.getUTCFullYear());
  const currentMonthIndex = now.getUTCMonth();
  const currentMonthStart = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}-01`;

  const [monthlyRecords, dailyRecords] = await Promise.all([
    prisma.brandCustomerActual.findMany(),
    prisma.dailyBrandCustomerActual.findMany(),
  ]);
  if (monthlyRecords.length === 0 && dailyRecords.length === 0) return dataset;

  interface DbRow {
    date: string;
    year: string;
    month: string;
    monthIndex: number;
    principal: string;
    brand: string;
    salesEmployee: string;
    customerName: string;
    cases: number;
    revenue: number;
    grossProfit: number;
  }
  const byKey = new Map<string, DbRow>();

  for (const r of monthlyRecords) {
    if (r.year === currentYear && r.monthIndex === currentMonthIndex) continue; // current month comes from the daily table instead
    const date = `${r.year}-${String(r.monthIndex + 1).padStart(2, "0")}-01`;
    const key = `${date}|${normalizePrincipalKey(r.principal)}|${r.brand}|${r.sapName}|${r.customerName}`;
    byKey.set(key, {
      date,
      year: r.year,
      month: r.month,
      monthIndex: r.monthIndex,
      principal: r.principal,
      brand: r.brand,
      salesEmployee: r.sapName,
      customerName: r.customerName,
      cases: r.cases,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
    });
  }

  for (const r of dailyRecords) {
    const dateKey = r.date.toISOString().slice(0, 10);
    if (dateKey < currentMonthStart) continue; // pre-current-month days are already covered by the monthly aggregate above
    const key = `${dateKey}|${normalizePrincipalKey(r.principal)}|${r.brand}|${r.sapName}|${r.customerName}`;
    byKey.set(key, {
      date: dateKey,
      year: String(r.date.getUTCFullYear()),
      month: CANONICAL_MONTHS[r.date.getUTCMonth()],
      monthIndex: r.date.getUTCMonth(),
      principal: r.principal,
      brand: r.brand,
      salesEmployee: r.sapName,
      customerName: r.customerName,
      cases: r.cases,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
    });
  }

  const snapshotKeysCoveredByLiveData = new Set(
    Array.from(byKey.values(), (db) => `${db.date}|${normalizePrincipalKey(db.principal)}|${db.salesEmployee}|${db.customerName}`)
  );
  const merged: MonthlyBrandCustomerRow[] = dataset.monthlyBrandCustomer.filter(
    (row) => !snapshotKeysCoveredByLiveData.has(`${row.date}|${row.principalKey}|${row.salesEmployee}|${row.customerName}`)
  );

  for (const db of byKey.values()) {
    merged.push({
      date: db.date,
      year: db.year,
      month: db.month,
      monthIndex: db.monthIndex,
      principal: db.principal,
      principalKey: normalizePrincipalKey(db.principal),
      brand: db.brand,
      salesEmployee: db.salesEmployee,
      customerName: db.customerName,
      cases: db.cases,
      revenue: db.revenue,
      grossProfit: db.grossProfit,
      grossMarginPct: db.revenue > 0 ? Math.round((db.grossProfit / db.revenue) * 1000) / 10 : null,
    });
  }

  return { ...dataset, monthlyBrandCustomer: merged };
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

  const monthlyCoverageTargets: MonthlyCoverageTargetRow[] = targets.map((target) => ({
    year: target.year,
    month: target.month,
    monthIndex: target.monthIndex,
    principal: target.principal,
    principalKey: normalizePrincipalKey(target.principal),
    coverageTarget: target.coverageTarget && target.coverageTarget > 0 ? target.coverageTarget : null,
    productivityTarget: target.productivityTarget && target.productivityTarget > 0 ? target.productivityTarget : null,
  }));

  return {
    ...dataset,
    monthlyCoverageTargets,
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

/** Promotes the latest complete direct SAP stock snapshot to the operational
 * Stock Balance. Dormant zero-piece items deliberately live in
 * DormantStockActual instead, so they cannot inflate the live action list. */
async function overlayStock(dataset: Dataset): Promise<Dataset> {
  const rows = await prisma.stockActual.findMany({ orderBy: { sourceDate: "desc" } });
  if (rows.length === 0) return dataset;

  const stockItems: StockItem[] = rows.map((row) => ({
    principal: row.principal,
    key: normalizePrincipalKey(row.principal),
    item: row.item,
    openingVolume: row.openingVolume,
    openingPcs: row.openingPcs,
    openingValue: row.openingValue,
    rrWeekValue: row.rrWeekValue,
    rrWeekVolume: row.rrWeekVolume,
    daysCover: row.daysCover,
    action: row.action,
  }));
  const sourceDate = rows.reduce((latest, row) => row.sourceDate > latest ? row.sourceDate : latest, rows[0].sourceDate);
  return {
    ...dataset,
    stockItems,
    stockTotal: stockTotalFromItems(stockItems),
    stockSource: { kind: "sap-direct", sourceDate: sourceDate.toISOString(), itemCount: stockItems.length },
  };
}

async function overlayAdminData(dataset: Dataset): Promise<Dataset> {
  // overlaySales must run before overlayTargets — it can replace/append
  // monthlySales rows, and overlayTargets's merge needs to see the final set.
  const withSales = await overlaySales(dataset);
  const [withTargets, withPL, withCoverage, withBrandCustomer, withStock] = await Promise.all([
    overlayTargets(withSales),
    overlayPL(dataset),
    overlayCoverage(dataset),
    overlayBrandCustomer(dataset),
    overlayStock(dataset),
  ]);
  return {
    ...withTargets,
    monthlyPL: withPL.monthlyPL,
    monthlyCoverage: withCoverage.monthlyCoverage,
    monthlyBrandCustomer: withBrandCustomer.monthlyBrandCustomer,
    stockItems: withStock.stockItems,
    stockTotal: withStock.stockTotal,
    stockSource: withStock.stockSource,
  };
}

export function stockTotalFromItems(stockItems: StockItem[]): StockTotal {
  let volume = 0, pcs = 0, value = 0, rrWeekValue = 0, rrWeekVolume = 0;
  let outOfStockCount = 0, runningOutCount = 0, okCount = 0, noDataCount = 0;
  for (const item of stockItems) {
    volume += item.openingVolume;
    pcs += item.openingPcs;
    value += item.openingValue;
    rrWeekValue += item.rrWeekValue;
    rrWeekVolume += item.rrWeekVolume;
    const tier = item.action.includes("\u{1F534}") ? "bad" : item.action.includes("\u{1F7E1}") ? "warn" : item.action.includes("\u{1F7E2}") ? "good" : "nodata";
    if (tier === "bad") outOfStockCount += 1;
    else if (tier === "warn") runningOutCount += 1;
    else if (tier === "good") okCount += 1;
    else noDataCount += 1;
  }
  const daysStock = weightedCoverDays(value, rrWeekValue);
  return {
    volume,
    pcs,
    value,
    rrWeekValue,
    rrWeekVolume,
    daysStock,
    itemCount: stockItems.length,
    outOfStockCount,
    runningOutCount,
    okCount,
    noDataCount,
    action: stockStatus(daysStock, value, rrWeekValue),
  };
}

/** Restricts a Dataset to a set of principals (a TEAM_LEADER session's own
 *  TeamLeaderAssignment-derived scope — see lib/teamLeaderScope.ts). Applied
 *  once, here, at the single upstream source every analytics page/report
 *  reads from — not threaded through lib/timeIntelligence.ts's many
 *  summarizers, none of which need to change. `principalKeys` are already-
 *  normalized (normalizePrincipalKey'd) values; every array is matched by
 *  its own normalized key so raw-string spelling differences between
 *  sources (Excel vs. Pine vs. SAP) don't cause false exclusions. stockTotal
 *  is fully recomputed from the filtered stockItems (reusing parseWorkbook's
 *  own weightedCoverDays/stockStatus formulas) rather than left as a stale
 *  company-wide figure next to a scoped item table. */
export function filterDatasetToPrincipals(dataset: Dataset, principalKeys: Set<string>): Dataset {
  const monthlySales = dataset.monthlySales.filter((r) => principalKeys.has(r.principalKey));
  const monthlyCoverage = dataset.monthlyCoverage.filter((r) => principalKeys.has(r.principalKey));
  const monthlyBrandCustomer = dataset.monthlyBrandCustomer.filter((r) => principalKeys.has(r.principalKey));
  const monthlyPL = dataset.monthlyPL.filter((r) => principalKeys.has(r.principalKey));
  const stockItems = dataset.stockItems.filter((i) => principalKeys.has(i.key));

  const stockTotal = stockTotalFromItems(stockItems);

  return { ...dataset, monthlySales, monthlyCoverage, monthlyBrandCustomer, monthlyPL, stockItems, stockTotal };
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
