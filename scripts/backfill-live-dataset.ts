/**
 * One-time cutover helper for retiring the Excel Snapshot as a runtime source.
 *
 * It copies only rows missing from the direct fact tables, so it can safely run
 * after the server-to-server syncs: live rows always win and are never changed.
 * Default mode is a dry run. Run `npx tsx scripts/backfill-live-dataset.ts
 * --apply` only against the production database after reviewing the printed
 * source counts.
 */
// Production invokes this inside the Compose network with DATABASE_URL already
// supplied. Local dry runs may still use the repository's .env file.
if (!process.env.DATABASE_URL) process.loadEnvFile();

import { prisma } from "@/lib/db";
import { getLatestLegacySnapshot } from "@/lib/datasetStore";

const CHUNK_SIZE = 500;
const apply = process.argv.includes("--apply");

async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<{ count: number }>) {
  let count = 0;
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    count += (await insert(rows.slice(index, index + CHUNK_SIZE))).count;
  }
  return count;
}

async function main() {
  const snapshot = await getLatestLegacySnapshot();
  if (!snapshot) throw new Error("No legacy snapshot is available for backfill.");

  const sales = snapshot.monthlySales.map((row) => ({
    year: row.year,
    month: row.month,
    monthIndex: row.monthIndex,
    location: row.location,
    principal: row.principal,
    revenue: row.revenue,
    cogs: row.cogs,
    grossProfit: row.grossProfit,
  }));
  const targets = snapshot.monthlySales
    .filter((row) => row.target !== null)
    .map((row) => ({
      year: row.year,
      month: row.month,
      monthIndex: row.monthIndex,
      principal: row.principal,
      valueTarget: row.target,
    }));
  const coverage = snapshot.monthlyCoverage.map((row) => ({
    year: row.year,
    month: row.month,
    monthIndex: row.monthIndex,
    salesRole: row.salesRole,
    employeeName: row.employeeName,
    principal: row.principal,
    coverage: Math.round(row.coverage),
    productiveCalls: Math.round(row.productiveCalls),
  }));

  // The snapshot may carry real day-grain rows in its newest month whereas
  // BrandCustomerActual is monthly grain. Aggregate them before the insert;
  // the direct day-grain table remains authoritative for the open month.
  const brandCustomer = new Map<string, {
    year: string; month: string; monthIndex: number; principal: string; brand: string;
    sapName: string; customerName: string; cases: number; revenue: number; grossProfit: number;
  }>();
  for (const row of snapshot.monthlyBrandCustomer) {
    const brand = row.brand?.trim() || "Unspecified";
    const key = [row.year, row.monthIndex, row.principal, brand, row.salesEmployee, row.customerName].join("\u0000");
    const existing = brandCustomer.get(key);
    if (existing) {
      existing.cases += row.cases;
      existing.revenue += row.revenue;
      existing.grossProfit += row.grossProfit;
    } else {
      brandCustomer.set(key, {
        year: row.year,
        month: row.month,
        monthIndex: row.monthIndex,
        principal: row.principal,
        brand,
        sapName: row.salesEmployee,
        customerName: row.customerName,
        cases: row.cases,
        revenue: row.revenue,
        grossProfit: row.grossProfit,
      });
    }
  }

  console.table({
    mode: apply ? "APPLY — missing rows only" : "DRY RUN — no data will be written",
    snapshot: snapshot.reportMeta.title,
    snapshotUploadedAt: snapshot.uploadedAt,
    salesRows: sales.length,
    targetRows: targets.length,
    coverageRows: coverage.length,
    brandCustomerRows: brandCustomer.size,
  });
  if (!apply) {
    console.log("Review the counts, then run again with --apply to backfill missing direct rows.");
    return;
  }

  // Brand/customer history exists at two incompatible grains: the legacy
  // Snapshot has customer/principal rows with brand="Unspecified", while the
  // SAP bridge stores item/customer/principal rows. Row-level skipDuplicates
  // cannot protect against mixing those grains because `brand` is part of the
  // unique key. Treat any already-present period as authoritative and skip the
  // entire legacy period; otherwise a later backfill almost exactly doubles
  // revenue while still satisfying the database uniqueness constraint.
  const existingBrandCustomerPeriods = new Set(
    (await prisma.brandCustomerActual.findMany({ select: { year: true, monthIndex: true }, distinct: ["year", "monthIndex"] }))
      .map((row) => `${row.year}|${row.monthIndex}`)
  );
  const brandCustomerToInsert = [...brandCustomer.values()].filter((row) => !existingBrandCustomerPeriods.has(`${row.year}|${row.monthIndex}`));

  const [salesInserted, targetsInserted, coverageInserted, brandCustomerInserted] = await Promise.all([
    insertInChunks(sales, (rows) => prisma.salesRecord.createMany({ data: rows, skipDuplicates: true })),
    insertInChunks(targets, (rows) => prisma.target.createMany({ data: rows, skipDuplicates: true })),
    insertInChunks(coverage, (rows) => prisma.coverageActual.createMany({ data: rows, skipDuplicates: true })),
    insertInChunks(brandCustomerToInsert, (rows) => prisma.brandCustomerActual.createMany({ data: rows, skipDuplicates: true })),
  ]);

  // Stock is operational/current-state data. Backfill it only if the live
  // stock sync has not populated anything yet; never mix old snapshot items
  // into a verified direct SAP snapshot.
  const directStockCount = await prisma.stockActual.count();
  let stockInserted = 0;
  if (directStockCount === 0 && snapshot.stockItems.length > 0) {
    const sourceDate = new Date(snapshot.uploadedAt);
    stockInserted = await insertInChunks(
      snapshot.stockItems.map((item) => ({
        sourceDate,
        principal: item.principal,
        item: item.item,
        itemCode: "legacy-snapshot",
        openingVolume: item.openingVolume,
        openingPcs: item.openingPcs,
        openingValue: item.openingValue,
        rrWeekValue: item.rrWeekValue,
        rrWeekVolume: item.rrWeekVolume,
        daysCover: item.daysCover,
        action: item.action,
      })),
      (rows) => prisma.stockActual.createMany({ data: rows, skipDuplicates: true })
    );
  }

  console.table({ salesInserted, targetsInserted, coverageInserted, brandCustomerInserted, stockInserted });
}

main()
  .catch((error) => {
    console.error("[backfill-live-dataset] FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
