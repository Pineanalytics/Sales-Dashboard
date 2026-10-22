// The coverage frequency extract as files: a CSV of the raw outlet rows, and an Excel workbook with the summary (the example's three "Total Coverage"
// tables), the same raw rows, and notes. The summary cells are COUNTIFS over the workbook's own "Outlet Data" sheet (with their values cached), so
// the summary can be re-cut in Excel from the raw rows, and the raw rows can be pivoted into anything else.
import * as XLSX from "xlsx";
import { CADENCES, CONFECTIONERY_BRANDS, frequencySourceLabel, type FrequencyOutlet, type FrequencyReport, type FrequencyTable } from "./frequency";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yesNo = (value: boolean) => (value ? "Yes" : "No");

interface Column {
  header: string;
  value: (outlet: FrequencyOutlet) => string | number;
}

/** The raw rows' columns, in order. The summary formulas find their columns by header, so reordering here keeps them right. */
export const OUTLET_COLUMNS: Column[] = [
  { header: "Source", value: (o) => frequencySourceLabel(o.source) },
  { header: "Outlet ID", value: (o) => o.outletKey },
  { header: "Outlet", value: (o) => o.outletName },
  { header: "Channel (Group)", value: (o) => o.channelGroup },
  { header: "Channel", value: (o) => o.channel },
  { header: "Segment / Type", value: (o) => o.segment },
  { header: "Source Channel", value: (o) => o.rawChannel },
  { header: "Source Segment / Type", value: (o) => o.rawSegment },
  { header: "Region (Group)", value: (o) => o.regionGroup },
  { header: "Region", value: (o) => o.region },
  { header: "Territory", value: (o) => o.territory },
  { header: "Location", value: (o) => o.location },
  { header: "Route", value: (o) => o.route },
  { header: "Rep", value: (o) => o.rep },
  { header: "Team Leader", value: (o) => o.teamLeader },
  { header: "Principals", value: (o) => o.principals },
  { header: "Bought Confectionery", value: (o) => yesNo(o.boughtConfectionery) },
  { header: "Bought Other Principals", value: (o) => yesNo(o.boughtOther) },
  { header: "Purchase Days", value: (o) => o.purchaseDays },
  { header: "Purchase Days (Confectionery)", value: (o) => o.purchaseDaysConfectionery },
  { header: "Purchase Days (Excl. Confectionery)", value: (o) => o.purchaseDaysOther },
  { header: "Months Bought", value: (o) => o.monthsBought },
  { header: "First Purchase", value: (o) => o.firstPurchase },
  { header: "Last Purchase", value: (o) => o.lastPurchase },
  { header: "Cadence", value: (o) => o.cadenceAll },
  { header: "Cadence (Excl. Confectioneries)", value: (o) => o.cadenceOther ?? "" },
  ...MONTHS.map((month, m): Column => ({ header: `${month} Purchase Days`, value: (o) => o.daysByMonth[m] ?? 0 })),
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

const col = (name: string) => {
  const index = header(name);
  if (index < 0) throw new Error(`Unknown outlet column ${name}`);
  const letter = columnLetter(index);
  return `'Outlet Data'!$${letter}:$${letter}`;
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

/** One summary table at (zero-based) row `top`, starting in column B like the example; returns its rows and the row after it. */
function placeTable(
  grid: SheetCell[][],
  merges: XLSX.Range[],
  top: number,
  t: FrequencyTable,
  groupColumn: string,
  cadenceColumn: string,
  confColumn: string | null
): number {
  const cadenceCols = CADENCES.length; // C..F
  const put = (r: number, c: number, value: SheetCell) => {
    grid[r] ??= [];
    grid[r][c] = value;
  };
  put(top, 2, t.title);
  merges.push({ s: { r: top, c: 2 }, e: { r: top, c: 1 + cadenceCols } });
  put(top + 1, 1, t.rowHeader);
  CADENCES.forEach((c, i) => put(top + 1, 2 + i, c));
  let next = 2 + cadenceCols;
  const confAt = confColumn ? next++ : -1;
  const totalAt = next;
  if (confColumn) put(top + 1, confAt, "Confectioneries");
  put(top + 1, totalAt, "Total Outlets");

  const first = top + 2;
  t.rows.forEach((row, i) => {
    const r = first + i;
    put(r, 1, row.label);
    CADENCES.forEach((c, k) => put(r, 2 + k, count(row.counts[c], `COUNTIFS(${groupColumn},$B${r + 1},${cadenceColumn},${columnLetter(2 + k)}$${top + 2})`)));
    if (confColumn) put(r, confAt, count(row.confectionery ?? 0, `COUNTIFS(${groupColumn},$B${r + 1},${confColumn},"Yes")`));
    put(r, totalAt, count(row.total, `SUM(C${r + 1}:${columnLetter(1 + cadenceCols)}${r + 1})`));
  });
  const totalRow = first + t.rows.length;
  put(totalRow, 1, "Total");
  CADENCES.forEach((c, k) => put(totalRow, 2 + k, count(t.total.counts[c], `SUM(${columnLetter(2 + k)}${first + 1}:${columnLetter(2 + k)}${totalRow})`)));
  if (confColumn) put(totalRow, confAt, count(t.total.confectionery ?? 0, `SUM(${columnLetter(confAt)}${first + 1}:${columnLetter(confAt)}${totalRow})`));
  put(totalRow, totalAt, count(t.total.total, `SUM(${columnLetter(totalAt)}${first + 1}:${columnLetter(totalAt)}${totalRow})`));
  return totalRow + 3;
}

export function frequencyWorkbook(report: FrequencyReport, filterNotes: string[] = []): Buffer {
  const { period, outlets, summary } = report;
  const grid: SheetCell[][] = [];
  const merges: XLSX.Range[] = [];
  grid[0] = [];
  grid[0][1] = `Coverage frequency: ${period.label}`;
  grid[1] = [];
  grid[1][1] = `${outlets.length.toLocaleString("en-US")} outlets bought in the period. Each outlet is counted once, at the best cadence it kept up. See the Notes sheet.`;
  let top = 3;
  top = placeTable(grid, merges, top, summary.including, col("Channel (Group)"), col("Cadence"), col("Bought Confectionery"));
  top = placeTable(grid, merges, top, summary.excluding, col("Channel (Group)"), col("Cadence (Excl. Confectioneries)"), null);
  placeTable(grid, merges, top, summary.byRegion, col("Region (Group)"), col("Cadence (Excl. Confectioneries)"), null);

  const summarySheet = XLSX.utils.aoa_to_sheet(grid.map((row) => Array.from(row ?? [], (v) => (v === undefined ? null : v))) as unknown as unknown[][]);
  summarySheet["!merges"] = merges;
  summarySheet["!cols"] = [{ wch: 3 }, { wch: 24 }, ...Array.from({ length: 6 }, () => ({ wch: 18 }))];

  // Dense mode and a compressed zip: a quarter is 58,000 rows by 38 columns, which as a sparse sheet in an uncompressed zip took 900 MB and made an 80 MB file.
  const dataSheet = XLSX.utils.aoa_to_sheet([OUTLET_COLUMNS.map((c) => c.header), ...outlets.map((o) => OUTLET_COLUMNS.map((c) => c.value(o)))], { dense: true } as XLSX.AOA2SheetOpts);
  dataSheet["!cols"] = OUTLET_COLUMNS.map((c) => ({ wch: Math.max(12, Math.min(34, c.header.length + 2)) }));
  dataSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, outlets.length), c: OUTLET_COLUMNS.length - 1 } }) };

  const notes: string[][] = [
    ["Coverage frequency extract"],
    [`Period: ${period.label} (${period.start.toISOString().slice(0, 10)} to ${new Date(period.end.getTime() - 86_400_000).toISOString().slice(0, 10)})`],
    ...(filterNotes.length ? [[`Filters: ${filterNotes.join("; ")}`]] : [["Filters: none (all outlets in your scope)"]]),
    [""],
    ["Covered means bought. An outlet is in the extract when it had at least one purchase day in the period. Purchase days come from the same feeds as the Active Outlet universe: Pine sales and orders, Leverage invoices, EABL DMS productive calls and Upfield DataEdge sales."],
    ["Each outlet is counted once, in the best cadence it kept up over the period:"],
    ["  Once Per Month: bought in every month of the period that has started."],
    ["  Once in 3 Months: bought in every quarter of the period (and not every month)."],
    ["  Once in 6 Months: bought in every half-year of the period (and not every quarter)."],
    ["  Once per Year: bought at least once (and not in every half-year)."],
    ["A week or a month holds one month, so any purchase is Once Per Month. A month that has not finished counts from its first day, so a current-year view expects a purchase in every month so far, this month included."],
    [`Confectioneries: ${CONFECTIONERY_BRANDS.map((b) => b[0].toUpperCase() + b.slice(1)).join(", ")} (all of the principal, including any non-confectionery lines it sells). "Excluding Confectioneries" counts only purchases of the other principals; an outlet that bought only confectionery is not in those tables. The Confectioneries column counts outlets that bought confectionery at any cadence.`],
    ["Channel and Region rows use this system's values (Retail, Wholesale, Modern Trade, On Trade, Others; the regions in the data, with the smallest grouped as Others). Source Channel and Source Segment / Type carry each system's own labels so they can be re-mapped in a pivot."],
    ["The four systems share no outlet ID, so a shop served by two systems appears once per system. The Active/Inactive status filter is ignored: an outlet that bought in the period counts whatever it is today."],
    ["The Summary sheet is made of COUNTIFS formulas over the Outlet Data sheet: filter or edit the data and the summary follows. Purchase feeds start at different dates (Pine and Upfield January 2026, EABL May 2026, Leverage June 2026), so earlier periods are incomplete for the later systems."],
  ];
  const notesSheet = XLSX.utils.aoa_to_sheet(notes);
  notesSheet["!cols"] = [{ wch: 150 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, dataSheet, "Outlet Data");
  XLSX.utils.book_append_sheet(workbook, notesSheet, "Notes");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
}
