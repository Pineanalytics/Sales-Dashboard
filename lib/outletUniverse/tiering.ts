// The Active Outlet extract's tiering format (the "active-outlets-principal-2026-Analysis" workbook, built into the export).
//
//  - Channel is only Wholesale or Retail. Wholesale is the outlet type "Wholesalers"; every other type is Retail.
//  - No "General" or "Unspecified" place or segment: a place falls back to the next supported column (territory, region, location),
//    and an unspecified segment to the underlying channel (Wholesale -> Wholesalers, otherwise Retailers).
//  - Outlets that share a name (one row per principal, or per source) take the segment, and so the channel, of the row with the highest
//    Sales YTD (the first one on a tie), and their sales are added together before tiering: "Combined Avg Sales (Outlet)" is the sum of
//    each row's Average Sales (Sales YTD / Transactions YTD) over rows with that name, and the Tier is read from it, so each outlet name
//    has one tier. The segment and channel are taken per exact outlet name (upper and lower case count); the combined average sums
//    rows whose names match ignoring only upper / lower case (as Excel's SUMIFS does), which is how the analysis workbook works.
//  - Only active rows (bought in the activity window) take part when a name has any; a name with none uses all of its rows.
//
// Merging by name joins different outlets that happen to share one ("Tamasha", "Rubis"): that is how the analysis workbook works too.

export const WHOLESALE_SEGMENT = "Wholesalers";
export const RETAIL_SEGMENT = "Retailers";

export type TierChannel = "Wholesale" | "Retail";

/** Blank, "Unspecified" and "General" are placeholders, not places. */
export function isPlaceholderPlace(value: string | null | undefined): boolean {
  const text = (value ?? "").trim().toLowerCase();
  return text === "" || text === "unspecified" || text === "general";
}

export interface PlaceFields {
  location: string;
  region: string;
  territory: string;
}

/** Fills a placeholder place from the other supported columns: location <- territory <- region, region <- territory <- location,
 *  territory <- region <- location. A row with no real place at all is left blank rather than guessed. */
export function cleanPlaces(row: PlaceFields): PlaceFields {
  const real = (value: string) => (isPlaceholderPlace(value) ? null : value.trim());
  const pick = (...candidates: string[]) => candidates.map(real).find((value) => value !== null) ?? "";
  return {
    location: pick(row.location, row.territory, row.region),
    region: pick(row.region, row.territory, row.location),
    territory: pick(row.territory, row.region, row.location),
  };
}

/** The segment with "Unspecified" replaced by the one the channel implies. */
export function defaultSegment(segment: string, channel: string): string {
  if (!isPlaceholderPlace(segment)) return segment.trim();
  return channel.trim().toLowerCase() === "wholesale" ? WHOLESALE_SEGMENT : RETAIL_SEGMENT;
}

/** Wholesale when the outlet type is Wholesalers; everything else is Retail. */
export function channelForSegment(segment: string): TierChannel {
  return segment.trim().toLowerCase() === WHOLESALE_SEGMENT.toLowerCase() ? "Wholesale" : "Retail";
}

export const NO_SALES_TIER = "No Sales Data";

/** The tier of an outlet from its combined average sale, by channel. Null (nothing to average) is "No Sales Data". */
export function tierFor(channel: TierChannel, combinedAverage: number | null): string {
  if (combinedAverage === null || !Number.isFinite(combinedAverage)) return NO_SALES_TIER;
  if (channel === "Wholesale") {
    if (combinedAverage <= 5000) return "5,000 & Below";
    if (combinedAverage <= 10000) return "5,001 - 10,000";
    if (combinedAverage <= 20000) return "10,001 - 20,000";
    if (combinedAverage <= 50000) return "20,001 - 50,000";
    return "Above 50,000";
  }
  if (combinedAverage <= 500) return "500 & Below";
  if (combinedAverage <= 1000) return "501 - 1,000";
  if (combinedAverage <= 5000) return "1,001 - 5,000";
  if (combinedAverage < 10000) return "5,001 - 9,999";
  return "10,000 & Above";
}

/** One row's Average Sales: Sales YTD over Transactions YTD, null when there are no transactions. */
export function averageSales(sales: number, transactions: number): number | null {
  return transactions > 0 ? sales / transactions : null;
}

export interface ProfileInput {
  outletName: string;
  channel: string;
  segment: string;
  sales: number;
  transactions: number;
  active: boolean;
}

export interface NameProfiles {
  /** Per exact outlet name: the segment of its highest-selling row and the channel that segment implies. */
  shape: Map<string, { segment: string; channel: TierChannel }>;
  /** Per outlet name ignoring case: the sum of the rows' Average Sales; null when none of them has transactions. */
  combined: Map<string, number | null>;
}

/** The lookup key of an outlet name for the combined average: ignoring case only. Blank names have no key (they are never merged). */
export function nameKey(name: string): string | null {
  return name.trim() === "" ? null : name.toLowerCase();
}

/** The profiles of every outlet name, from every row that carries it (pass the whole universe, not just the exported rows). */
export function buildNameProfiles(rows: ProfileInput[]): NameProfiles {
  const exact = new Map<string, ProfileInput[]>();
  const insensitive = new Map<string, ProfileInput[]>();
  for (const row of rows) {
    if (nameKey(row.outletName) === null) continue;
    const a = exact.get(row.outletName);
    if (a) a.push(row);
    else exact.set(row.outletName, [row]);
    const key = row.outletName.toLowerCase();
    const b = insensitive.get(key);
    if (b) b.push(row);
    else insensitive.set(key, [row]);
  }
  const eligibleOf = (group: ProfileInput[]) => (group.some((row) => row.active) ? group.filter((row) => row.active) : group);
  const shape = new Map<string, { segment: string; channel: TierChannel }>();
  for (const [name, group] of exact) {
    const eligible = eligibleOf(group);
    let top = eligible[0];
    for (const row of eligible) if (row.sales > top.sales) top = row;
    const segment = defaultSegment(top.segment, top.channel);
    shape.set(name, { segment, channel: channelForSegment(segment) });
  }
  const combined = new Map<string, number | null>();
  for (const [key, group] of insensitive) {
    let total: number | null = null;
    for (const row of eligibleOf(group)) {
      const average = averageSales(row.sales, row.transactions);
      if (average !== null) total = (total ?? 0) + average;
    }
    combined.set(key, total);
  }
  return { shape, combined };
}

export interface TieredRow {
  channel: TierChannel;
  segment: string;
  averageSales: number | null;
  combinedAverage: number | null;
  tier: string;
}

/** The tiering columns of one exported row: its name's profile when it has one, else the row on its own. */
export function tierRow(row: ProfileInput, profiles: NameProfiles): TieredRow {
  const average = averageSales(row.sales, row.transactions);
  const key = nameKey(row.outletName);
  const shape = key === null ? undefined : profiles.shape.get(row.outletName);
  const combined = key === null ? undefined : profiles.combined.get(key);
  const segment = shape?.segment ?? defaultSegment(row.segment, row.channel);
  const channel = shape?.channel ?? channelForSegment(segment);
  const combinedAverage = key === null || combined === undefined ? average : combined;
  return { channel, segment, averageSales: average, combinedAverage, tier: tierFor(channel, combinedAverage) };
}

/** "Primary + Secondary" is Primary Sales (the workbook's Classification2). Anything else is unchanged. */
export function classification2(classification: string): string {
  return classification === "Primary + Secondary" ? "Primary Sales" : classification;
}
