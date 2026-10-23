// The coverage frequency extract as files: a CSV of the raw outlet rows, and an Excel workbook with the summary (Total Coverage by channel, and Direct and
// Indirect by channel and by region), the same raw rows ("Raw Data"), and notes. The summary cells are COUNTIFS over the workbook's own Raw Data sheet
// (with their values cached), so the summary can be re-cut in Excel from the raw rows, and the raw rows can be pivoted into anything else.
import * as XLSX from "xlsx";
import { CADENCES, CONFECTIONERY_BRANDS, type FrequencyOutlet, type FrequencyReport, type FrequencyTable } from "./frequency";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yesNo = (value: boolean) => (value ? "Yes" : "No");
const orBlank = (value: number | null) => (value === null ? "" : value);

interface Column {
  header: string;
  value: (outlet: FrequencyOutlet) => string | number;
}

/** The raw rows' columns, in order. The summary formulas find their columns by header, so reordering here keeps them right. */
export const OUTLET_COLUMNS: Column[] = [
  { header: "Source", value: (o) => o.source },
  { header: "Outlet ID", value: (o) => o.outletKey },
  { header: "Outlet", value: (o) => o.outletName },
  { header: "Channel", value: (o) => o.channel },
  { header: "Segment / Type", value: (o) => o.segment },
  { header: "Source Segment / Type", value: (o) => o.sourceSegment },
  { header: "Tier", value: (o) => o.tier },
  { header: "Region", value: (o) => o.regionGroup },
  { header: "Source Region", value: (o) => o.region },
  { header: "Territory", value: (o) => o.territory },
  { header: "Classification", value: (o) => o.classification },
  { header: "Absolute Principal", value: (o) => o.absolutePrincipal },
  { header: "Principals", value: (o) => o.principals },
  { header: "Team Leader", value: (o) => o.teamLeader },
  { header: "Bought Confectionery", value: (o) => yesNo(o.boughtConfectionery) },
  { header: "Bought Other Principals", value: (o) => yesNo(o.boughtOther) },
  { header: "Average Sales", value: (o) => orBlank(o.averageSales) },
  { header: "Combined Avg Sales (Outlet)", value: (o) => orBlank(o.combinedAverage) },
  { header: "Purchase Days", value: (o) => o.purchaseDays },
  { header: "Purchase Days (Confectionery)", value: (o) => o.purchaseDaysConfectionery },
  { header: "Purchase Days (Excl. Confectionery)", value: (o) => o.purchaseDaysOther },
  { header: "Purchase Days per Month", value: (o) => o.purchaseDaysPerMonth },
  { header: "Months Bought", value: (o) => o.monthsBought },
  { header: "First Purchase", value: (o) => o.firstPurchase },
  { header: "Last Purchase", value: (o) => o.lastPurchase },
  { header: "Cadence", value: (o) => o.cadenceAll },
  { header: "Cadence (Excl. Confectioneries)", value: (o) => o.cadenceOther ?? "" },
  ...MONTHS.map((month, m): Column => ({ header: `${month} Purchase Days`, value: (o) => o.daysByMonth[m] ?? 0 })),
  { header: "Periods Bought (last 3 x 30 days)", value: (o) => o.periodsBought90 },
  { header: "Consistency", value: (o) => o.consistency90 },
  { header: "Periods Bought (last 6 x 30 days)", value: (o) => o.periodsBought180 },
  { header: "Consistency (6 months)", value: (o) => o.consistency180 },
  { header: "Buying Tenure", value: (o) => o.buyingTenure },
];

const header = (name: string) => OUTLET_COLUMNS.findIndex((c) => c.header === name);

/** Spreadsheet column letters for a zero-based index (0 = A, 26 = AA). */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

const RAW_SHEET = "Raw Data";

const col = (name: string) => {
  const index = header(name);
  if (index < 0) throw new Error(`Unknown outlet column ${name}`);
  const letter = columnLetter(index);
  return `'${RAW_SHEET}'!$${letter}:$${letter}`;
};

/** CSV cells that start with = + - @ are neutralised so a spreadsheet never runs an outlet name as a formula. */
function cell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function frequencyCsv(outlets: FrequencyOutlet[]): string {
  const lines = [OUTLET_COLUMNS.map((c) => cell(c.header)).join(",")];
  for (const outlet of outlets) lines.push(OUTLET_COLUMNS.map((c) => cell(c.value(outlet))).join(","));
  return lines.join("\r\n");
}

export function frequencyFileStem(report: FrequencyReport): string {
  const { kind, year, quarter, month, week } = report.period;
  if (kind === "week") return `coverage-frequency-${year}-W${String(week).padStart(2, "0")}`;
  if (kind === "month") return `coverage-frequency-${year}-${String(month).padStart(2, "0")}`;
  if (kind === "quarter") return `coverage-frequency-${year}-Q${quarter}`;
  return `coverage-frequency-${year}`;
}

type SheetCell = string | number | { t: "n"; v: number; f?: string };

const count = (v: number, f?: string): SheetCell => ({ t: "n", v, ...(f ? { f } : {}) });

/** One summary table with its title row at (zero-based) `top`, its labels in column `left`; returns the zero-based row of its Total line.
 *  `classification` narrows the count to Direct or Indirect outlets (a criterion on the Classification column). */
function placeTable(
  grid: SheetCell[][],
  merges: XLSX.Range[],
  top: number,
  left: number,
  t: FrequencyTable,
  groupColumn: string,
  classification: "Direct" | "Indirect" | null
): number {
  const put = (r: number, c: number, value: SheetCell) => {
    grid[r] ??= [];
    grid[r][c] = value;
  };
  const cadenceCol = col("Cadence");
  const classCol = col("Classification");
  put(top, left + 1, t.title);
  merges.push({ s: { r: top, c: left + 1 }, e: { r: top, c: left + CADENCES.length } });
  put(top + 1, left, t.rowHeader);
  CADENCES.forEach((c, i) => put(top + 1, left + 1 + i, c));

  const first = top + 2;
  const labelCol = columnLetter(left);
  t.rows.forEach((row, i) => {
    const r = first + i;
    put(r, left, row.label);
    CADENCES.forEach((c, k) => {
      const letter = columnLetter(left + 1 + k);
      const criteria = `${groupColumn},$${labelCol}${r + 1},${cadenceCol},${letter}$${top + 2}${classification ? `,${classCol},"${classification}"` : ""}`;
      put(r, left + 1 + k, count(row.counts[c], `COUNTIFS(${criteria})`));
    });
  });
  const totalRow = first + t.rows.length;
  put(totalRow, left, "Total");
  CADENCES.forEach((c, k) => {
    const letter = columnLetter(left + 1 + k);
    put(totalRow, left + 1 + k, count(t.total.counts[c], `SUM(${letter}${first + 1}:${letter}${totalRow})`));
  });
  return totalRow;
}

export function frequencyWorkbook(report: FrequencyReport, filterNotes: string[] = []): Buffer {
  const { period, outlets, summary } = report;
  const grid: SheetCell[][] = [];
  const merges: XLSX.Range[] = [];
  grid[0] = [];
  grid[0][1] = `Coverage frequency: ${period.label}`;
  grid[1] = [];
  grid[1][1] = `${outlets.length.toLocaleString("en-US")} outlets bought in the period. Each outlet is counted once, at the best cadence it kept up. See the Notes sheet.`;

  // The layout of the example: the all-outlet table, then Direct (left, from column B) and Indirect (right, from column I) side by side by channel,
  // then the same by region.
  const channelCol = col("Channel");
  const regionCol = col("Region");
  const allEnd = placeTable(grid, merges, 2, 1, summary.all, channelCol, null);
  const channelTop = allEnd + 3;
  const channelEnd = placeTable(grid, merges, channelTop, 1, summary.directChannel, channelCol, "Direct");
  placeTable(grid, merges, channelTop, 8, summary.indirectChannel, channelCol, "Indirect");
  const regionTop = channelEnd + 4;
  placeTable(grid, merges, regionTop, 1, summary.directRegion, regionCol, "Direct");
  placeTable(grid, merges, regionTop, 8, summary.indirectRegion, regionCol, "Indirect");

  const summarySheet = XLSX.utils.aoa_to_sheet(grid.map((row) => Array.from(row ?? [], (v) => (v === undefined ? null : v))) as unknown as unknown[][]);
  summarySheet["!merges"] = merges;
  summarySheet["!cols"] = [{ wch: 3 }, { wch: 24 }, ...Array.from({ length: 12 }, () => ({ wch: 17 }))];

  // Dense mode and a compressed zip: a quarter is about 58,000 rows, which as a sparse sheet in an uncompressed zip took 900 MB and made an 80 MB file.
  const dataSheet = XLSX.utils.aoa_to_sheet([OUTLET_COLUMNS.map((c) => c.header), ...outlets.map((o) => OUTLET_COLUMNS.map((c) => c.value(o)))], { dense: true } as XLSX.AOA2SheetOpts);
  dataSheet["!cols"] = OUTLET_COLUMNS.map((c) => ({ wch: Math.max(12, Math.min(34, c.header.length + 2)) }));
  dataSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, outlets.length), c: OUTLET_COLUMNS.length - 1 } }) };

  const notes: string[][] = [
    ["Coverage frequency extract"],
    [`Period: ${period.label} (${period.start.toISOString().slice(0, 10)} to ${new Date(period.end.getTime() - 86_400_000).toISOString().slice(0, 10)})`],
    ...(filterNotes.length ? [[`Filters: ${filterNotes.join("; ")}`]] : [["Filters: none (all outlets in your scope)"]]),
    [""],
    ["Built the way the Active Outlets extract is built: the same outlet rows, name profiles and tiering (segment, channel, Average Sales, Combined Avg Sales, Tier), one row per outlet. Central, Nyeri and Nyahururu outlets are included."],
    ["Covered means bought. An outlet is in the extract when it had at least one purchase day in the period. Purchase days come from the same feeds as the Active Outlet universe: Pine sales and orders, Leverage invoices, EABL DMS productive calls and Upfield DataEdge sales."],
    ["Each outlet is counted once, in the best cadence it kept up over the period:"],
    ["  Once Per Month: bought in every month of the period that has started."],
    ["  Once in 3 Months: bought in every quarter of the period (and not every month)."],
    ["  Once in 6 Months: bought in every half-year of the period (and not every quarter)."],
    ["  Once per Year: bought at least once (and not in every half-year)."],
    ["A week or a month holds one month, so any purchase is Once Per Month. A month that has not finished counts from its first day, so a current-year view expects a purchase in every month so far, this month included. In a quarter Once in 6 Months and Once per Year cannot occur."],
    ["Absolute Principal: the principal with the largest sales at the outlet. Principals lists every principal the outlet buys."],
    ["Classification: how the Absolute Principal reaches the outlet. Primary Sales is Direct, Secondary Sales is Indirect (Primary + Secondary on that principal counts as Primary, as in the tiering workbook)."],
    ["Channel (from the tiered Segment / Type): Wholesalers (Wholesalers, Distributor), Minimart, LMT (Supermarkets, Large Modern Trade, Hyper), Institutions, Key Accounts (outlets served by a key account manager of the confectionery principal), Others (retail of every kind, horeca, anything else). DTR has no segment mapped to it, so it is empty."],
    ["Region: Nairobi, Mountain (Central, Nyeri and Nyahururu together), Eastern, and Others. A region that is a place (1Tana River, Isiolo) or a placeholder (Unspecified, General) takes the branch the outlet is served from, which is Nairobi for Pine. Source Region is the region as cleaned by the Active Outlets extract."],
    [`Confectioneries: ${CONFECTIONERY_BRANDS.map((b) => b[0].toUpperCase() + b.slice(1)).join(", ")} (all of the principal). Bought Other Principals and Cadence (Excl. Confectioneries) count only purchases of the other principals.`],
    ["Average Sales is Sales YTD over Transactions YTD, Combined Avg Sales (Outlet) adds the averages of every row of the same outlet name, and Tier is read from it, exactly as in the Active Outlets extract. Periods Bought, Consistency and Buying Tenure are the extract's buying-history columns as of today."],
    ["The four systems share no outlet ID, so a shop served by two systems appears once per system. The Active/Inactive status filter is ignored: an outlet that bought in the period counts whatever it is today."],
    ["The Summary sheet is made of COUNTIFS formulas over the Raw Data sheet: filter or edit the data and the summary follows. Purchase feeds start at different dates (Pine and Upfield January 2026, EABL May 2026, Leverage June 2026), so earlier periods are incomplete for the later systems."],
  ];
  const notesSheet = XLSX.utils.aoa_to_sheet(notes);
  notesSheet["!cols"] = [{ wch: 150 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, dataSheet, RAW_SHEET);
  XLSX.utils.book_append_sheet(workbook, notesSheet, "Notes");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}
