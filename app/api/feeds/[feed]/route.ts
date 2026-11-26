import { NextRequest, NextResponse } from "next/server";
import {
  dataFeedById,
  EABL_TIMESTAMP_COLUMNS,
  EABL_TIMESTAMPS_FEED,
  OUTLET_MASTER_FEED,
  parseFeedColumns,
  PRODUCT_FEED_COLUMNS,
  PRODUCT_MASTER_FEED,
  PRODUCT_SUPPLIER_COLUMNS,
  UNILEVER_PRODUCT_COLUMNS,
  UNILEVER_PRODUCTS_FEED,
} from "@/lib/dataFeedScript";
import { eablTimestampCsv, loadEablTimestampRows, resolveEablTimestampPeriod } from "@/lib/eablTimestampFeed";
import { verifyFeedKey } from "@/lib/dataFeeds";
import { oneAtATime } from "@/lib/outletUniverse/exportQueue";
import { loadFrequencyReport, resolveFrequencyPeriod, type FrequencyReport } from "@/lib/outletUniverse/frequency";
import { frequencyCsvColumns, OUTLET_COLUMNS } from "@/lib/outletUniverse/frequencyExport";
import { parseOutletFilters } from "@/lib/outletUniverse/query";
import { loadProductMasterData, productMasterCsv, type ProductMasterData } from "@/lib/productMasterFeed";
import { loadUnileverProducts, unileverProductCsv, unileverSalesWindow, type UnileverProductData } from "@/lib/unileverProductList";

export const runtime = "nodejs";

// The CSV is sent without a byte-order mark: Power Query reads it as UTF-8 (the script says so), and a BOM could stay glued to the first
// column name, hiding that column (the Product Master's Item Code).
export const dynamic = "force-dynamic";

/** How long a built report is reused, so several workbooks refreshing together build it once. */
const CACHE_MS = 10 * 60_000;
/** Calls arrive through the day, so their feed is reused for less. */
const TIMESTAMP_CACHE_MS = 3 * 60_000;
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

const timestampCache = new Map<string, { at: number; day: string; data: Awaited<ReturnType<typeof loadEablTimestampRows>> }>();

/** The EABL calls for a period, reused for a few minutes so several workbooks refreshing together read the table once. The Nairobi day is part of
 *  the cache key's check, so a period that rolls with the date is never served from yesterday. */
async function eablTimestampData(period: ReturnType<typeof resolveEablTimestampPeriod>) {
  const day = period.endExclusive.toISOString().slice(0, 10);
  const hit = timestampCache.get(period.value);
  if (hit && hit.day === day && Date.now() - hit.at < TIMESTAMP_CACHE_MS) return hit.data;
  const data = await loadEablTimestampRows(period);
  timestampCache.set(period.value, { at: Date.now(), day, data });
  return data;
}

let unileverCache: { at: number; data: UnileverProductData } | null = null;

/** The Unilever product list, reused for ten minutes (it reads every synced Centegy sales line); rebuilt when the Nairobi day rolls, so the
 *  90-day window never lags a day. */
async function unileverProductData(): Promise<UnileverProductData> {
  const today = unileverSalesWindow().asOf;
  if (unileverCache && unileverCache.data.asOf === today && Date.now() - unileverCache.at < CACHE_MS) return unileverCache.data;
  const data = await oneAtATime(() => loadUnileverProducts());
  if (data.rows.length > 0) unileverCache = { at: Date.now(), data };
  return data;
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
 *  - product-master: SAP's item master (SapItem, refreshed by the sap-items job every 30 minutes), one row per item, no period.
 *  - eabl-timestamps: every EABL DMS call (EablCall) in ?period=last30 (default), month, last90 or ytd, one row per customer visit with check-in/out.
 *  - unilever-products: Unilever's own SKU list from Centegy as the Sales & Returns sync stores it (lib/unileverProductList.ts), one row per SKU,
 *    no period; its sales columns cover the last 90 days. */
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
    if (feed.id === UNILEVER_PRODUCTS_FEED.id) {
      const columns = parseFeedColumns(params.get("columns"), UNILEVER_PRODUCT_COLUMNS, feed.defaultColumns);
      const data = await unileverProductData();
      return new NextResponse(unileverProductCsv(data, columns), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Feed-Period": `Sales columns: ${data.windowStart.toISOString().slice(0, 10)} to ${data.asOf}`,
          "X-Feed-Rows": String(data.rows.length),
        },
      });
    }
    if (feed.id === EABL_TIMESTAMPS_FEED.id) {
      const columns = parseFeedColumns(params.get("columns"), EABL_TIMESTAMP_COLUMNS, feed.defaultColumns);
      const resolved = resolveEablTimestampPeriod(period);
      const data = await eablTimestampData(resolved);
      return new NextResponse(eablTimestampCsv(data.rows, columns), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Feed-Period": resolved.label,
          "X-Feed-Generated-At": (data.syncedAt ?? new Date()).toISOString(),
          "X-Feed-Rows": String(data.rows.length),
        },
      });
    }
    return NextResponse.json({ error: "Unknown feed." }, { status: 404 });
  } catch (error) {
    console.error(`Failed to build the ${feed.id} feed for key "${holder.name}"`, error);
    return NextResponse.json({ error: "Failed to build the feed." }, { status: 500 });
  }
}
