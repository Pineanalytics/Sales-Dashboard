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
  /** Columns the script reads as dates (served as yyyy-mm-dd). */
  dateColumns?: string[];
  /** The feed's default period; "" for a feed with no period (a master-data snapshot). */
  defaultPeriod: string;
  /** Empty for a feed with no period. */
  periods: { value: string; label: string }[];
  /** Every column the server can serve, when the list is client-safe (the outlet feed's lives with its extract). */
  servedColumns?: string[];
  /** Product Master only: supplier codes by item-code prefix, written into the script as an editable table. The script works out
   *  Supplier Code / Supplier / Supplier Code Source from SAP first and this table second; those three columns are made in the
   *  workbook, not served. */
  prefixSuppliers?: PrefixSupplier[];
}

export interface PrefixSupplier {
  prefix: string;
  supplierCode: string;
  supplier: string;
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

/** The columns the script makes itself from SAP's supplier columns and the prefix table (see powerQueryScript). */
export const PRODUCT_SUPPLIER_COLUMNS = ["Supplier Code", "Supplier", "Supplier Code Source"];

/** What the script needs from the server to make the supplier columns, whatever columns were chosen. */
const PRODUCT_SUPPLIER_INPUTS = ["Item Code", "Preferred Supplier Code", "Preferred Supplier", "Last Received Supplier Code", "Last Received Supplier"];

/** Supplier codes by item-code prefix (Suplier_Code.xlsx, Nov 2026), for items SAP gives no supplier for. SUN is listed once for both
 *  Bidco and Suntory (one code, S-0135); the sheet's HCM row says "Unallocated", which is Highchem. */
export const PRODUCT_SUPPLIER_PREFIXES: PrefixSupplier[] = [
  { prefix: "BNT", supplierCode: "S-0222", supplier: "Bennet" },
  { prefix: "BIC", supplierCode: "S-0156", supplier: "Bic" },
  { prefix: "SUN", supplierCode: "S-0135", supplier: "Bidco / Suntory" },
  { prefix: "DEL", supplierCode: "S-0054", supplier: "Delmonte" },
  { prefix: "DKT", supplierCode: "S-0014", supplier: "DKT" },
  { prefix: "DUREX", supplierCode: "S-0077", supplier: "Durex" },
  { prefix: "KBL", supplierCode: "S-0075", supplier: "EABL" },
  { prefix: "CEY", supplierCode: "S-0176", supplier: "EFL" },
  { prefix: "ELX", supplierCode: "S-0038", supplier: "Elex" },
  { prefix: "EPL", supplierCode: "S-0188", supplier: "Energia" },
  { prefix: "GDJ", supplierCode: "S-0011", supplier: "Godrej" },
  { prefix: "JMR", supplierCode: "S-0152", supplier: "Jumra" },
  { prefix: "MARS", supplierCode: "S-0124", supplier: "Mars" },
  { prefix: "PIC", supplierCode: "S-0220", supplier: "Milly Fruits" },
  { prefix: "MOV", supplierCode: "S-0092", supplier: "Movit" },
  { prefix: "NES", supplierCode: "S-0058", supplier: "Nestle" },
  { prefix: "PREM", supplierCode: "S-0080", supplier: "Premier" },
  { prefix: "PROM", supplierCode: "S-0160", supplier: "Promasidor" },
  { prefix: "SIG", supplierCode: "S-0041", supplier: "Signify" },
  { prefix: "TPL", supplierCode: "S-0009", supplier: "Tropikal" },
  { prefix: "KMFY", supplierCode: "S-0171", supplier: "Ukl-Intl." },
  { prefix: "CER", supplierCode: "S-0099", supplier: "Weetabix" },
  { prefix: "HCM", supplierCode: "S-0230", supplier: "Highchem" },
  { prefix: "UKL", supplierCode: "S-0141", supplier: "Unilever" },
  { prefix: "UP", supplierCode: "S-0046", supplier: "Upfield" },
  // Added from SAP's own receipts and AP invoices (every item of the prefix that SAP has a supplier for came from this one code), Nov 2026.
  { prefix: "TR", supplierCode: "S-0229", supplier: "Trade Roots" },
  { prefix: "WEET", supplierCode: "S-0099", supplier: "Weetabix" },
  { prefix: "MEGA", supplierCode: "S-0079", supplier: "Mega Wholesalers" },
  { prefix: "UDV", supplierCode: "S-0074", supplier: "UDV (Kenya)" },
];

/** Every column the Product Master feed serves (app/api/feeds/[feed]/route.ts builds them from SapItem). */
export const PRODUCT_FEED_COLUMNS = [
  "Item Code",
  "Item Name",
  "Foreign Name",
  "Item Group Code",
  "Item Group",
  "Manufacturer Code",
  "Manufacturer",
  "Principal",
  "Inventory UOM",
  "Sales UOM",
  "Purchase UOM",
  "Units Per Sales Unit",
  "Units Per Purchase Unit",
  "On Hand Qty",
  "Committed Qty",
  "On Order Qty",
  "Average Cost",
  "Last Purchase Price",
  "Preferred Supplier Code",
  "Preferred Supplier",
  "Last Received Supplier Code",
  "Last Received Supplier",
  "Last Received Date",
  "Active",
  "Frozen",
  "Created Date",
  "Last Updated Date",
  "Selling Price",
  "Selling Currency",
  "Purchase Price",
  "Purchase Currency",
];

/** The Product Master: SAP's item master (the Product_Query extract), refreshed from SAP every 30 minutes, with the dashboard principal
 *  and a supplier code for every item. */
export const PRODUCT_MASTER_FEED: DataFeedDefinition = {
  id: "product-master",
  label: "Product Master",
  description:
    "Every SAP item with its group, manufacturer, units, stock, costs and prices (SAP item master, refreshed every 30 minutes), plus the dashboard principal and a supplier code: SAP's preferred supplier, else the supplier of its last goods receipt, else the item-code prefix list in the script.",
  defaultColumns: [
    "Item Code",
    "Item Name",
    "Foreign Name",
    "Item Group Code",
    "Item Group",
    "Manufacturer Code",
    "Manufacturer",
    "Principal",
    "Supplier Code",
    "Supplier",
    "Supplier Code Source",
    "Inventory UOM",
    "Sales UOM",
    "Purchase UOM",
    "Units Per Sales Unit",
    "Units Per Purchase Unit",
    "On Hand Qty",
    "Committed Qty",
    "On Order Qty",
    "Average Cost",
    "Last Purchase Price",
    "Active",
    "Frozen",
    "Created Date",
    "Last Updated Date",
    "Selling Price",
    "Selling Currency",
    "Purchase Price",
    "Purchase Currency",
  ],
  defaultRenames: {},
  numberColumns: [
    "Item Group Code",
    "Manufacturer Code",
    "Units Per Sales Unit",
    "Units Per Purchase Unit",
    "On Hand Qty",
    "Committed Qty",
    "On Order Qty",
    "Average Cost",
    "Last Purchase Price",
    "Selling Price",
    "Purchase Price",
  ],
  dateColumns: ["Created Date", "Last Updated Date", "Last Received Date"],
  defaultPeriod: "",
  periods: [],
  servedColumns: PRODUCT_FEED_COLUMNS,
  prefixSuppliers: PRODUCT_SUPPLIER_PREFIXES,
};

export const DATA_FEEDS: DataFeedDefinition[] = [OUTLET_MASTER_FEED, PRODUCT_MASTER_FEED];

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

function mColumnType(feed: DataFeedDefinition, column: string): string {
  if (feed.numberColumns.includes(column)) return "type number";
  if (feed.dateColumns?.includes(column)) return "type date";
  return "type text";
}

/** The steps that make Supplier Code / Supplier / Supplier Code Source: SAP's preferred supplier, else the supplier of the item's last
 *  goods receipt, else the longest item-code prefix in SupplierCodes (a whole prefix: UP matches UP00012, not UPLIFT01). */
function supplierSteps(prefixes: PrefixSupplier[]): string[] {
  return [
    `    // The supplier columns. SAP first: the item's preferred supplier, else the supplier of its last goods receipt. Then SupplierCodes:`,
    `    // add or change rows to cover items SAP has no supplier for. The longest matching prefix wins, matched whole (UP matches UP00012, not UPLIFT01).`,
    `    SupplierCodes = #table(type table [Prefix = text, #"Supplier Code" = text, Supplier = text], {`,
    prefixes.map((p) => `        {${mText(p.prefix)}, ${mText(p.supplierCode)}, ${mText(p.supplier)}}`).join(",\n"),
    `    }),`,
    `    Prefixes = List.Sort(Table.ToRecords(SupplierCodes), (a, b) => Value.Compare(Text.Length(b[Prefix]), Text.Length(a[Prefix]))),`,
    `    PrefixMatch = (code as nullable text) as nullable record =>`,
    `        let`,
    `            upper = if code = null then "" else Text.Upper(Text.Trim(code)),`,
    `            hits = List.Select(Prefixes, (p) => Text.StartsWith(upper, Text.Upper(p[Prefix])) and not List.Contains({"A".."Z"}, Text.Middle(upper, Text.Length(p[Prefix]), 1)))`,
    `        in`,
    `            List.First(hits, null),`,
    `    IsBlank = (value) => value = null or Text.Trim(Text.From(value)) = "",`,
    `    WithSupplier = Table.AddColumn(Promoted, "Supplier Match", each`,
    `        if not IsBlank([Preferred Supplier Code]) then [Code = [Preferred Supplier Code], Name = [Preferred Supplier], Source = "SAP preferred supplier"]`,
    `        else if not IsBlank([Last Received Supplier Code]) then [Code = [Last Received Supplier Code], Name = [Last Received Supplier], Source = "SAP last goods receipt"]`,
    `        else let match = PrefixMatch([Item Code]) in`,
    `            if match = null then [Code = null, Name = null, Source = "Not found"] else [Code = match[Supplier Code], Name = match[Supplier], Source = "Prefix list"]),`,
    `    Suppliers = Table.ExpandRecordColumn(WithSupplier, "Supplier Match", {"Code", "Name", "Source"}, {"Supplier Code", "Supplier", "Supplier Code Source"}),`,
    `    Selected = Table.SelectColumns(Suppliers, Columns, MissingField.UseNull),`,
  ];
}

/** The Power Query script for a workbook that pulls a feed. Every choice sits in a named step at the top (Period, Columns, Renames, and the
 *  Product Master's SupplierCodes), so it can be changed in Excel's Advanced Editor without touching the rest. The key goes in a header,
 *  not the address. */
export function powerQueryScript(input: { baseUrl: string; feed: DataFeedDefinition; key: string; period?: string; columns?: string[]; renames?: Record<string, string> }): string {
  const { feed } = input;
  const columns = input.columns ?? feed.defaultColumns;
  const renames = input.renames ?? feed.defaultRenames;
  const hasPeriod = feed.periods.length > 0;
  const period = input.period ?? feed.defaultPeriod;
  const base = input.baseUrl.replace(/\/$/, "");
  const suppliers = feed.prefixSuppliers;
  const renamePairs = Object.entries(renames).filter(([from]) => columns.includes(from));
  const typed = columns.map((column) => `{${mText(renames[column] ?? column)}, ${mColumnType(feed, column)}}`);
  // Blank number and date cells come through as "", which would be a conversion error, so they become empty (null) first.
  const nonText = columns.filter((column) => mColumnType(feed, column) !== "type text").map((column) => mText(renames[column] ?? column));
  const query = [hasPeriod ? "period = Period" : null, `columns = Text.Combine(${suppliers ? "Requested" : "Columns"}, "|")`].filter(Boolean).join(", ");
  const editable = hasPeriod ? "Period, Columns or Renames" : suppliers ? "Columns, Renames or SupplierCodes" : "Columns or Renames";
  return [
    `// ${feed.label} — live from the Pinefrost dashboard (${base}).`,
    `// Refresh: Data > Refresh All. To change what comes in, edit ${editable} below.`,
    ...(hasPeriod ? [`// Periods: ${feed.periods.map((p) => `"${p.value}" = ${p.label}`).join(", ")}.`] : []),
    `// Columns: any of the feed's column names, in the order you want them. Renames: feed name -> name in this workbook.`,
    ...(feed.servedColumns ? [`// The feed's columns: ${[...feed.servedColumns, ...(suppliers ? PRODUCT_SUPPLIER_COLUMNS : [])].join(", ")}.`] : []),
    `let`,
    `    FeedKey = ${mText(input.key)},`,
    ...(hasPeriod ? [`    Period = ${mText(period)},`] : []),
    `    Columns = {${columns.map(mText).join(", ")}},`,
    `    Renames = {${renamePairs.map(([from, to]) => `{${mText(from)}, ${mText(to)}}`).join(", ")}},`,
    ...(suppliers
      ? [`    Requested = List.Distinct(List.RemoveItems(Columns, {${PRODUCT_SUPPLIER_COLUMNS.map(mText).join(", ")}}) & {${PRODUCT_SUPPLIER_INPUTS.map(mText).join(", ")}}),`]
      : []),
    `    Source = Csv.Document(`,
    `        Web.Contents(${mText(base)}, [`,
    `            RelativePath = ${mText(`api/feeds/${feed.id}`)},`,
    `            Query = [${query}],`,
    `            Headers = [${mField("X-Feed-Key")} = FeedKey],`,
    `            Timeout = #duration(0, 0, 10, 0)`,
    `        ]),`,
    `        [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]`,
    `    ),`,
    `    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),`,
    ...(suppliers ? supplierSteps(suppliers) : []),
    `    Renamed = Table.RenameColumns(${suppliers ? "Selected" : "Promoted"}, Renames, MissingField.Ignore),`,
    ...(nonText.length > 0 ? [`    Blanks = Table.ReplaceValue(Renamed, "", null, Replacer.ReplaceValue, {${nonText.join(", ")}}),`] : []),
    `    Typed = Table.TransformColumnTypes(${nonText.length > 0 ? "Blanks" : "Renamed"}, {${typed.join(", ")}}, "en-US")`,
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
