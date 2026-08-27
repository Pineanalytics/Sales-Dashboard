import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { normalizePrincipalKey } from "./normalize";
import { encodeDataset, decodeDataset } from "./snapshotCodec";
import { CANONICAL_MONTHS } from "./timeIntelligence";
import { weightedCoverDays, stockStatus } from "./parseWorkbook";
import { getMonthlyCoverageRollup, getEablMonthlyCoverageRollup } from "./jpAdherence";
import type { Dataset, DatasetSnapshotSummary, MonthlyBrandCustomerRow, MonthlyCoverageRow, MonthlyCoverageTargetRow, MonthlyPLRow, MonthlySalesRow, PLLineType, StockItem, StockTotal } from "./types";

// The primary dashboard dataset is composed from tables written by the
// server-to-server syncs. The legacy Snapshot blob is archive-only and is not
// read on the normal request path.
const DATASET_MEMORY_TTL_MS = 5 * 60_000;
const liveDatasetMemory = new Map<boolean, { value: Dataset | null; expiresAt: number }>();
const liveDatasetInFlight = new Map<boolean, Promise<Dataset | null>>();

function emptyLiveDataset(): Dataset {
  return {
    monthlySales: [],
    monthlyCoverage: [],
    monthlyCoverageTargets: [],
    monthlyBrandCustomer: [],
    monthlyPL: [],
    stockItems: [],
    stockTotal: stockTotalFromItems([]),
    reportMeta: { title: "Server-synchronized dashboard data", sheet: "Live data" },
    uploadedAt: new Date().toISOString(),
  };
}

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
  const now = new Date();
  const currentYear = String(now.getUTCFullYear());
  const currentMonthIndex = now.getUTCMonth();
  const currentMonth = CANONICAL_MONTHS[currentMonthIndex];
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), currentMonthIndex, 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), currentMonthIndex + 1, 1));

  // For an open month, Customer & Brands has the freshest daily corrections.
  // Aggregate it to the cockpit's principal/month grain so both views use the
  // same canonical revenue rather than diverging after an intraday correction.
  const [records, liveCurrentMonth] = await Promise.all([
    prisma.salesRecord.findMany(),
    prisma.dailyBrandCustomerActual.groupBy({
      by: ["principal"],
      where: { date: { gte: currentMonthStart, lt: nextMonthStart } },
      _sum: { revenue: true, grossProfit: true },
    }),
  ]);
  if (records.length === 0 && liveCurrentMonth.length === 0) return dataset;

  const byKey = new Map(records.map((r) => [`${r.year}|${r.month}|${r.principal}`, r]));
  const snapshotLocationByPrincipal = new Map(
    dataset.monthlySales
      .filter((row) => row.year === currentYear && row.monthIndex === currentMonthIndex)
      .map((row) => [row.principal, row.location])
  );
  for (const row of liveCurrentMonth) {
    const revenue = row._sum.revenue ?? 0;
    const grossProfit = row._sum.grossProfit ?? 0;
    const key = `${currentYear}|${currentMonth}|${row.principal}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      id: existing?.id ?? "live-brand-customer",
      year: currentYear,
      month: currentMonth,
      monthIndex: currentMonthIndex,
      principal: row.principal,
      location: existing?.location ?? snapshotLocationByPrincipal.get(row.principal) ?? "Unassigned",
      revenue,
      grossProfit,
      cogs: revenue - grossProfit,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
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
  // EABL's own rollup (lib/jpAdherence.ts's getEablMonthlyCoverageRollup) is
  // merged in right alongside Pine's — same row shape, same merge-by-key
  // logic below, so Coverage & Productivity picks it up wherever an EABL
  // principal is selected with zero further changes to this function.
  const [directRows, pineRows, eablRows] = await Promise.all([
    prisma.coverageActual.findMany(),
    getMonthlyCoverageRollup(null),
    getEablMonthlyCoverageRollup(),
  ]);
  // A persisted direct month is authoritative for Pine coverage. RepCall stays
  // as a live fallback only until that month has been validated and saved;
  // EABL is a separate principal feed and is merged alongside either source.
  const directMonths = new Set(directRows.map((row) => `${row.year}|${row.monthIndex}`));
  const rollupRows = [
    ...directRows.map((row) => ({
      year: row.year,
      monthIndex: row.monthIndex,
      principalKey: normalizePrincipalKey(row.principal),
      principal: row.principal,
      salesRole: row.salesRole,
      employeeName: row.employeeName,
      coverage: row.coverage,
      productive: row.productiveCalls,
    })),
    ...pineRows.filter((row) => !directMonths.has(`${row.year}|${row.monthIndex}`)),
    ...eablRows,
  ];
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

  // Both queries used to be bare findMany() — a full scan of every row ever
  // synced (316k+/381k+ live) on every cache-miss, even though the loop below
  // only ever keeps the current-year/prior-year monthly rows and the current
  // month's daily rows. Filtering here instead of after the fetch keeps the
  // query (and this table's future growth) bounded — the daily filter alone
  // was discarding ~90% of what it fetched.
  //
  // Live EXPLAIN ANALYZE after that filter landed showed the SQL itself is
  // fast (22ms daily via the date-led unique index, 125ms monthly via a
  // cheap seq scan — 2025+2026 turned out to already BE the whole table, so
  // the year filter mostly guards against future growth, not today's cost).
  // But overlayAdminData's own timing still logged ~10s for this function.
  // Adding `select` (only the columns DbRow uses, dropping id/createdAt/
  // updatedAt) cut it to ~7.7s — real, but the fetch phase alone was still
  // ~6.1s of that for ~340k rows, confirmed via a fetchMs/mergeMs timing
  // split as Prisma Client's own model-hydration cost, not the SQL or the
  // merge loop. $queryRaw bypasses that hydration pipeline (same pattern
  // already used throughout lib/timestampSummary.ts/lib/jpAdherence.ts) -
  // still fully typed via the generic param, just skipping Prisma Client's
  // per-row model instantiation.
  const fetchStart = Date.now();
  const [monthlyRecords, dailyRecords] = await Promise.all([
    prisma.$queryRaw<
      { year: string; month: string; monthIndex: number; principal: string; brand: string; sapName: string; customerName: string; cases: number; revenue: number; grossProfit: number }[]
    >(Prisma.sql`
      SELECT year, month, "monthIndex", principal, brand, "sapName", "customerName", cases, revenue, "grossProfit"
      FROM "BrandCustomerActual"
    `),
    prisma.$queryRaw<
      { date: Date; principal: string; brand: string; sapName: string; customerName: string; cases: number; revenue: number; grossProfit: number }[]
    >(Prisma.sql`
      SELECT date, principal, brand, "sapName", "customerName", cases, revenue, "grossProfit"
      FROM "DailyBrandCustomerActual"
      WHERE date >= ${new Date(`${currentMonthStart}T00:00:00.000Z`)}
    `),
  ]);
  const fetchMs = Date.now() - fetchStart;
  if (monthlyRecords.length === 0 && dailyRecords.length === 0) return dataset;
  const mergeStart = Date.now();

  // Was: a DbRow intermediate keyed by Map, read back to build a Set (which
  // called normalizePrincipalKey AGAIN off the already-normalized value used
  // to build the map key), then read back a THIRD time to build the actual
  // MonthlyBrandCustomerRow output (normalizePrincipalKey a third time, plus
  // a second full object allocation per row) - normalizePrincipalKey costs a
  // trim + split + toLowerCase + regex replace, not free at ~340k rows x3.
  // The Map now holds the final MonthlyBrandCustomerRow shape directly -
  // principalKey and grossMarginPct computed exactly once, right where the
  // rest of the row's fields already are - so every later pass just reads
  // already-computed fields off the stored object instead of recomputing.
  const byKey = new Map<string, MonthlyBrandCustomerRow>();

  for (const r of monthlyRecords) {
    if (r.year === currentYear && r.monthIndex === currentMonthIndex) continue; // current month comes from the daily table instead
    const date = `${r.year}-${String(r.monthIndex + 1).padStart(2, "0")}-01`;
    const principalKey = normalizePrincipalKey(r.principal);
    const key = `${date}|${principalKey}|${r.brand}|${r.sapName}|${r.customerName}`;
    byKey.set(key, {
      date,
      year: r.year,
      month: r.month,
      monthIndex: r.monthIndex,
      principal: r.principal,
      principalKey,
      brand: r.brand,
      salesEmployee: r.sapName,
      customerName: r.customerName,
      cases: r.cases,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
      grossMarginPct: r.revenue > 0 ? Math.round((r.grossProfit / r.revenue) * 1000) / 10 : null,
    });
  }

  for (const r of dailyRecords) {
    const dateKey = r.date.toISOString().slice(0, 10);
    if (dateKey < currentMonthStart) continue; // pre-current-month days are already covered by the monthly aggregate above
    const principalKey = normalizePrincipalKey(r.principal);
    const key = `${dateKey}|${principalKey}|${r.brand}|${r.sapName}|${r.customerName}`;
    byKey.set(key, {
      date: dateKey,
      year: String(r.date.getUTCFullYear()),
      month: CANONICAL_MONTHS[r.date.getUTCMonth()],
      monthIndex: r.date.getUTCMonth(),
      principal: r.principal,
      principalKey,
      brand: r.brand,
      salesEmployee: r.sapName,
      customerName: r.customerName,
      cases: r.cases,
      revenue: r.revenue,
      grossProfit: r.grossProfit,
      grossMarginPct: r.revenue > 0 ? Math.round((r.grossProfit / r.revenue) * 1000) / 10 : null,
    });
  }

  // Direct tables are the primary source. When an archived Snapshot is opened,
  // live customer facts still take precedence rather than mixing both sources.
  const merged: MonthlyBrandCustomerRow[] = [...byKey.values()];

  const mergeMs = Date.now() - mergeStart;
  if (fetchMs > 200 || mergeMs > 200) {
    console.warn(
      `[datasetStore] loadBrandCustomer: fetch ${fetchMs}ms (${monthlyRecords.length} monthly + ${dailyRecords.length} daily rows) / shape ${mergeMs}ms / total ${fetchMs + mergeMs}ms`
    );
  }

  return { ...dataset, monthlyBrandCustomer: merged };
}

/** Returns only the requested customer/brand periods for an on-demand view.
 * This keeps the high-cardinality fact table out of the shared app payload. */
export async function getLiveBrandCustomerRows(periods: { year: string; monthIndex: number }[], principals: string[] = []): Promise<MonthlyBrandCustomerRow[]> {
  const requested = Array.from(new Map(
    periods
      .filter((period) => /^\d{4}$/.test(period.year) && Number.isInteger(period.monthIndex) && period.monthIndex >= 0 && period.monthIndex <= 11)
      .map((period) => [`${period.year}|${period.monthIndex}`, period])
  ).values());
  if (requested.length === 0) return [];

  const now = new Date();
  const currentYear = String(now.getUTCFullYear());
  const currentMonthIndex = now.getUTCMonth();
  const currentPeriodRequested = requested.some((period) => period.year === currentYear && period.monthIndex === currentMonthIndex);
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), currentMonthIndex, 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), currentMonthIndex + 1, 1));

  const [monthlyRows, dailyRows] = await Promise.all([
    prisma.brandCustomerActual.findMany({
        where: {
          OR: requested.map((period) => ({ year: period.year, monthIndex: period.monthIndex })),
          ...(principals.length > 0 ? { principal: { in: principals } } : {}),
        },
      select: { year: true, month: true, monthIndex: true, principal: true, brand: true, sapName: true, customerName: true, cases: true, revenue: true, grossProfit: true },
    }),
    currentPeriodRequested
      ? prisma.dailyBrandCustomerActual.findMany({
          where: {
            date: { gte: currentMonthStart, lt: nextMonthStart },
            ...(principals.length > 0 ? { principal: { in: principals } } : {}),
          },
        select: { date: true, principal: true, brand: true, sapName: true, customerName: true, cases: true, revenue: true, grossProfit: true },
      })
      : Promise.resolve([]),
  ]);

  const rows = new Map<string, MonthlyBrandCustomerRow>();
  for (const row of monthlyRows) {
    if (currentPeriodRequested && row.year === currentYear && row.monthIndex === currentMonthIndex) continue;
    const date = `${row.year}-${String(row.monthIndex + 1).padStart(2, "0")}-01`;
    const principalKey = normalizePrincipalKey(row.principal);
    const key = `${date}|${principalKey}|${row.brand}|${row.sapName}|${row.customerName}`;
    rows.set(key, {
      date,
      year: row.year,
      month: row.month,
      monthIndex: row.monthIndex,
      principal: row.principal,
      principalKey,
      brand: row.brand,
      salesEmployee: row.sapName,
      customerName: row.customerName,
      cases: row.cases,
      revenue: row.revenue,
      grossProfit: row.grossProfit,
      grossMarginPct: row.revenue > 0 ? Math.round((row.grossProfit / row.revenue) * 1000) / 10 : null,
    });
  }
  for (const row of dailyRows) {
    const date = row.date.toISOString().slice(0, 10);
    const principalKey = normalizePrincipalKey(row.principal);
    const key = `${date}|${principalKey}|${row.brand}|${row.sapName}|${row.customerName}`;
    rows.set(key, {
      date,
      year: String(row.date.getUTCFullYear()),
      month: CANONICAL_MONTHS[row.date.getUTCMonth()],
      monthIndex: row.date.getUTCMonth(),
      principal: row.principal,
      principalKey,
      brand: row.brand,
      salesEmployee: row.sapName,
      customerName: row.customerName,
      cases: row.cases,
      revenue: row.revenue,
      grossProfit: row.grossProfit,
      grossMarginPct: row.revenue > 0 ? Math.round((row.grossProfit / row.revenue) * 1000) / 10 : null,
    });
  }
  return [...rows.values()];
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

// Only fires on a loadLiveDataset cache MISS (getLiveDataset's
// process-memory wrapper skips this entirely on a hit) — every five minutes
// routine sync invalidation, not per-request, so this can't spam the logs.
// Cheap diagnostic for exactly the kind of regression this file already had
// once (a bare findMany() on a 300k+-row table): if one leg's duration jumps,
// it names which overlay to look at instead of guessing.
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - start;
    if (ms > 200) console.warn(`[datasetStore] overlay "${label}" took ${ms}ms`);
  }
}

async function overlayAdminData(dataset: Dataset, includeBrandCustomer = true): Promise<Dataset> {
  const overallStart = Date.now();
  // overlaySales must run before overlayTargets — it can replace/append
  // monthlySales rows, and overlayTargets's merge needs to see the final set.
  const withSales = await timed("sales", () => overlaySales(dataset));
  const [withTargets, withPL, withCoverage, withBrandCustomer, withStock] = await Promise.all([
    timed("targets", () => overlayTargets(withSales)),
    timed("pl", () => overlayPL(dataset)),
    timed("coverage", () => overlayCoverage(dataset)),
    includeBrandCustomer ? timed("brandCustomer", () => overlayBrandCustomer(dataset)) : Promise.resolve(dataset),
    timed("stock", () => overlayStock(dataset)),
  ]);
  console.log(`[datasetStore] overlayAdminData total: ${Date.now() - overallStart}ms`);
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

async function loadLiveDataset(includeBrandCustomer: boolean): Promise<Dataset | null> {
  const dataset = await overlayAdminData(emptyLiveDataset(), includeBrandCustomer);
  const hasLiveFacts = dataset.monthlySales.length > 0 || dataset.monthlyCoverage.length > 0 || dataset.monthlyBrandCustomer.length > 0 || dataset.monthlyPL.length > 0 || dataset.stockItems.length > 0;
  return hasLiveFacts ? dataset : null;
}

/** Primary analytics dataset: facts persisted by the server-to-server syncs.
 * Legacy Excel snapshots are intentionally excluded from this path. */
export async function getLiveDataset({ includeBrandCustomer = false }: { includeBrandCustomer?: boolean } = {}): Promise<Dataset | null> {
  const cached = liveDatasetMemory.get(includeBrandCustomer);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const inFlight = liveDatasetInFlight.get(includeBrandCustomer);
  if (inFlight) return inFlight;
  const request = loadLiveDataset(includeBrandCustomer)
    .then((value) => {
      liveDatasetMemory.set(includeBrandCustomer, { value, expiresAt: Date.now() + DATASET_MEMORY_TTL_MS });
      return value;
    })
    .finally(() => { liveDatasetInFlight.delete(includeBrandCustomer); });
  liveDatasetInFlight.set(includeBrandCustomer, request);
  return request;
}

/** Called by every synced-fact or admin-data writer so the next live dataset
 * read reflects the change immediately instead of waiting out the TTL. */
export function invalidateDatasetCache() {
  liveDatasetMemory.clear();
}

export async function getSnapshotById(id: string): Promise<Dataset | null> {
  const snapshot = await prisma.snapshot.findUnique({ where: { id } });
  if (!snapshot) return null;
  return overlayAdminData(decodeDataset(snapshot.data));
}

/** Archive-only read used by the bridge comparison scripts. It intentionally
 * returns the stored Excel-era baseline without applying live overlays. */
export async function getLatestLegacySnapshot(): Promise<Dataset | null> {
  const snapshot = await prisma.snapshot.findFirst({ orderBy: { uploadedAt: "desc" } });
  return snapshot ? decodeDataset(snapshot.data) : null;
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
