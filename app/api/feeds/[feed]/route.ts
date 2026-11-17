import { NextRequest, NextResponse } from "next/server";
import { dataFeedById, OUTLET_MASTER_FEED, parseFeedColumns, PRODUCT_FEED_COLUMNS, PRODUCT_MASTER_FEED, PRODUCT_SUPPLIER_COLUMNS } from "@/lib/dataFeedScript";
import { verifyFeedKey } from "@/lib/dataFeeds";
import { oneAtATime } from "@/lib/outletUniverse/exportQueue";
import { loadFrequencyReport, resolveFrequencyPeriod, type FrequencyReport } from "@/lib/outletUniverse/frequency";
import { frequencyCsvColumns, OUTLET_COLUMNS } from "@/lib/outletUniverse/frequencyExport";
import { parseOutletFilters } from "@/lib/outletUniverse/query";
import { loadProductMasterData, productMasterCsv, type ProductMasterData } from "@/lib/productMasterFeed";

export const runtime = "nodejs";

// The CSV is sent without a byte-order mark: Power Query reads it as UTF-8 (the script says so), and a BOM could stay glued to the first
// column name, hiding that column (the Product Master's Item Code).
export const dynamic = "force-dynamic";

/** How long a built report is reused, so several workbooks refreshing together build it once. */
const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { at: number; report: FrequencyReport }>();

async function outletMasterReport(periodKind: string): Promise<FrequencyReport> {
  const hit = cache.get(periodKind);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.report;
  const report = await oneAtATime(() =>
    loadFrequencyReport(resolveFrequencyPeriod(new URLSearchParams({ kind: periodKind })), parseOutletFilters(new URLSearchParams({ view: "general", status: "all" })), null)
  );
  cache.set(periodKind, { at: Date.now(), report });
  return report;
}

let productCache: { at: number; data: ProductMasterData } | null = null;

async function productMasterData(): Promise<ProductMasterData> {
  if (productCache && Date.now() - productCache.at < CACHE_MS) return productCache.data;
  const data = await oneAtATime(loadProductMasterData);
  // An empty item list means the sap-items job has not run yet: do not hold it for ten minutes once the first sync lands.
  if (data.items.length > 0) productCache = { at: Date.now(), data };
  return data;
}

/** A read-only data feed for an outside workbook (Power Query on SharePoint), authenticated by a feed key (X-Feed-Key header, or ?key=) that an
 *  admin creates on Admin > Data & sync — not by a dashboard login. Each feed is CSV, limited to the columns asked for (?columns=A|B|C, default:
 *  the feed's default columns).
 *  - outlet-master: the Active Outlets coverage-frequency extract for the whole company (one row per shop that bought in the period), for
 *    ?period=last6 (rolling six months, the default) or year (year to date).
 *  - product-master: SAP's item master (SapItem, refreshed by the sap-items job every 30 minutes), one row per item, no period. */
export async function GET(req: NextRequest, context: RouteContext<"/api/feeds/[feed]">) {
  const { feed: feedId } = await context.params;
  const feed = dataFeedById(feedId);
  if (!feed) return NextResponse.json({ error: "Unknown feed." }, { status: 404 });

  const params = req.nextUrl.searchParams;
  const key = req.headers.get("x-feed-key") ?? params.get("key");
  const holder = await verifyFeedKey(feed.id, key);
  if (!holder) return NextResponse.json({ error: "A valid feed key is required (X-Feed-Key header)." }, { status: 401 });

  const period = params.get("period") ?? feed.defaultPeriod;
  if (feed.periods.length > 0 && !feed.periods.some((option) => option.value === period)) {
    return NextResponse.json({ error: `period must be one of: ${feed.periods.map((option) => option.value).join(", ")}.` }, { status: 400 });
  }

  try {
    if (feed.id === OUTLET_MASTER_FEED.id) {
      const columns = parseFeedColumns(params.get("columns"), OUTLET_COLUMNS.map((column) => column.header), feed.defaultColumns);
      const report = await outletMasterReport(period);
      return new NextResponse(frequencyCsvColumns(report.outlets, columns), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Feed-Period": report.period.label,
          "X-Feed-Generated-At": report.generatedAt,
          "X-Feed-Rows": String(report.outlets.length),
        },
      });
    }
    if (feed.id === PRODUCT_MASTER_FEED.id) {
      // The supplier columns are made by the workbook's script, so they are not served.
      const defaults = feed.defaultColumns.filter((column) => !PRODUCT_SUPPLIER_COLUMNS.includes(column));
      const columns = parseFeedColumns(params.get("columns"), PRODUCT_FEED_COLUMNS, defaults);
      const data = await productMasterData();
      if (data.items.length === 0) {
        return NextResponse.json({ error: "The SAP item master has not been synced yet (sap-items job). Try again after its first run." }, { status: 503 });
      }
      return new NextResponse(productMasterCsv(data, columns), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Feed-Generated-At": (data.syncedAt ?? new Date()).toISOString(),
          "X-Feed-Rows": String(data.items.length),
        },
      });
    }
    return NextResponse.json({ error: "Unknown feed." }, { status: 404 });
  } catch (error) {
    console.error(`Failed to build the ${feed.id} feed for key "${holder.name}"`, error);
    return NextResponse.json({ error: "Failed to build the feed." }, { status: 500 });
  }
}
