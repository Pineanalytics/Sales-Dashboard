// The read-only data feeds an outside workbook can pull (see app/api/feeds/[feed]/route.ts), and the Power Query script that pulls one.
// Pure and client-safe: no keys are made or checked here (lib/dataFeeds.ts does that on the server).

export interface DataFeedDefinition {
  id: string;
  label: string;
  description: string;
  /** The columns the feed can serve, in their default order. */
  defaultColumns: string[];
  /** Workbook column names that differ from the feed's (feed name -> workbook name). */
  defaultRenames: Record<string, string>;
  /** Columns the script reads as numbers; every other column stays text. */
  numberColumns: string[];
  defaultPeriod: string;
  periods: { value: string; label: string }[];
}

/** The Outlet Master: the Active Outlets coverage-frequency extract (one row per shop that bought in the period), cut to the columns of the
 *  approved Outlet Master Data workbook shared on SharePoint. */
export const OUTLET_MASTER_FEED: DataFeedDefinition = {
  id: "outlet-master",
  label: "Outlet Master Data",
  description: "Every shop that bought in the period (Active Outlets coverage-frequency extract), one row per shop.",
  defaultColumns: [
    "Source",
    "Outlet ID",
    "Outlet",
    "Shop ID",
    "Systems",
    "Channel",
    "Segment / Type",
    "Region",
    "Territory",
    "Latitude",
    "Longitude",
    "Classification",
    "Absolute Principal",
    "Principals",
    "Team Leader",
  ],
  defaultRenames: { Principals: "Principals Associated", "Team Leader": "Absolute Team Leader" },
  numberColumns: ["Latitude", "Longitude"],
  defaultPeriod: "last6",
  periods: [
    { value: "last6", label: "Last 6 months (rolling)" },
    { value: "year", label: "Year to date" },
  ],
};

export const DATA_FEEDS: DataFeedDefinition[] = [OUTLET_MASTER_FEED];

export function dataFeedById(id: string): DataFeedDefinition | null {
  return DATA_FEEDS.find((feed) => feed.id === id) ?? null;
}

/** A Power Query (M) text literal. */
function mText(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** A Power Query record field name: plain when it is a simple identifier, quoted (#"...") otherwise. */
function mField(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `#${mText(name)}`;
}

/** The Power Query script for a workbook that pulls a feed. Every choice sits in a named step at the top (Period, Columns, Renames), so it can be
 *  changed in Excel's Advanced Editor without touching the rest. The key goes in a header, not the address. */
export function powerQueryScript(input: { baseUrl: string; feed: DataFeedDefinition; key: string; period?: string; columns?: string[]; renames?: Record<string, string> }): string {
  const columns = input.columns ?? input.feed.defaultColumns;
  const renames = input.renames ?? input.feed.defaultRenames;
  const period = input.period ?? input.feed.defaultPeriod;
  const base = input.baseUrl.replace(/\/$/, "");
  const renamePairs = Object.entries(renames).filter(([from]) => columns.includes(from));
  const typed = columns.map((column) => `{${mText(renames[column] ?? column)}, ${input.feed.numberColumns.includes(column) ? "type number" : "type text"}}`);
  return [
    `// ${input.feed.label} — live from the Pinefrost dashboard (${base}).`,
    `// Refresh: Data > Refresh All. To change what comes in, edit Period, Columns or Renames below.`,
    `// Periods: ${input.feed.periods.map((p) => `"${p.value}" = ${p.label}`).join(", ")}.`,
    `// Columns: any of the feed's column names, in the order you want them. Renames: feed name -> name in this workbook.`,
    `let`,
    `    FeedKey = ${mText(input.key)},`,
    `    Period = ${mText(period)},`,
    `    Columns = {${columns.map(mText).join(", ")}},`,
    `    Renames = {${renamePairs.map(([from, to]) => `{${mText(from)}, ${mText(to)}}`).join(", ")}},`,
    `    Source = Csv.Document(`,
    `        Web.Contents(${mText(base)}, [`,
    `            RelativePath = ${mText(`api/feeds/${input.feed.id}`)},`,
    `            Query = [period = Period, columns = Text.Combine(Columns, "|")],`,
    `            Headers = [${mField("X-Feed-Key")} = FeedKey],`,
    `            Timeout = #duration(0, 0, 10, 0)`,
    `        ]),`,
    `        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]`,
    `    ),`,
    `    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),`,
    `    Renamed = Table.RenameColumns(Promoted, Renames, MissingField.Ignore),`,
    `    Typed = Table.TransformColumnTypes(Renamed, {${typed.join(", ")}}, "en-US")`,
    `in`,
    `    Typed`,
  ].join("\n");
}

/** Parses a feed request's column list ("A|B|C"): known columns only, in the order asked, no repeats; the defaults when none is asked. */
export function parseFeedColumns(raw: string | null, available: string[], defaults: string[]): string[] {
  if (!raw || !raw.trim()) return defaults;
  const known = new Set(available);
  const chosen: string[] = [];
  for (const name of raw.split("|").map((part) => part.trim())) {
    if (known.has(name) && !chosen.includes(name)) chosen.push(name);
  }
  return chosen.length > 0 ? chosen : defaults;
}
