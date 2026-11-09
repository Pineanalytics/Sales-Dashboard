// The Reckitt universe as files: an Excel workbook (Summary, Raw Data, Definition Of Terms) and a CSV of the raw rows. The Summary is made of COUNTIFS formulas over the
// workbook's own Raw Data sheet (their values cached), so it can be re-cut in Excel from the raw rows. The Segment / Type column of Raw Data is highlighted yellow, as
// in the template this follows: it is the segment restructured from the source system's own (Source Segment / Type).
import * as XLSX from "xlsx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { columnLetter } from "./frequencyExport";
import {
  RECKITT_RELEVANT_SEGMENTS,
  RECKITT_RETAIL_MIN,
  RECKITT_SEGMENTS,
  RECKITT_TENURES,
  RECKITT_WHOLESALE_MIN,
  RECKITT_WINDOW_MONTHS,
  SEGMENT_GROUPS,
  buildReckittSummary,
  type ReckittOutlet,
  type ReckittReport,
  type ReckittTable,
  type UniverseTables,
} from "./reckitt";

const yesNo = (value: boolean) => (value ? "Yes" : "No");
const orBlank = (value: number | null) => (value === null ? "" : value);

interface Column {
  header: string;
  value: (outlet: ReckittOutlet) => string | number;
}

/** The raw rows' columns, in order, for a window whose months are labelled `months`. The summary formulas find their columns by header. */
export function reckittColumns(months: readonly string[]): Column[] {
  return [
    { header: "Source", value: (o) => o.source },
    { header: "Outlet ID", value: (o) => o.outletKey },
    { header: "Outlet", value: (o) => o.outletName },
    { header: "Shop ID", value: (o) => o.shopId },
    { header: "Outlets Merged", value: (o) => o.outletsMerged },
    { header: "Systems", value: (o) => o.systems },
    { header: "Merged Outlets", value: (o) => o.mergedOutlets },
    { header: "Channel", value: (o) => o.channel },
    { header: "Source Segment / Type", value: (o) => o.sourceSegment },
    { header: "Segment / Type", value: (o) => o.segment },
    { header: "Segment Restructured", value: (o) => yesNo(o.segmentRestructured) },
    { header: "Tier", value: (o) => o.tier },
    { header: "Region", value: (o) => o.regionGroup },
    { header: "Source Region", value: (o) => o.region },
    { header: "Territory", value: (o) => o.territory },
    { header: "Direct vs Indirect", value: (o) => o.classification },
    { header: "Absolute Principal", value: (o) => o.absolutePrincipal },
    { header: "Principals", value: (o) => o.principals },
    { header: "Team Leader", value: (o) => o.teamLeader },
    { header: "Average Sales", value: (o) => orBlank(o.averageSales) },
    { header: "Combined Avg Sales (Outlet)", value: (o) => orBlank(o.combinedAverage) },
    { header: "Purchase Days", value: (o) => o.purchaseDays },
    { header: "Purchase Days per Month", value: (o) => o.purchaseDaysPerMonth },
    { header: "Months Bought", value: (o) => o.monthsBought },
    { header: "First Purchase", value: (o) => o.firstPurchase },
    { header: "Last Purchase", value: (o) => o.lastPurchase },
    { header: "Active (90 days)", value: (o) => yesNo(o.active) },
    ...months.map((label, i): Column => ({ header: `${label} Purchase Days`, value: (o) => o.windowDays[i] ?? 0 })),
    { header: "Buying Tenure", value: (o) => o.tenure },
    { header: "Reckitt Selected", value: (o) => yesNo(o.selected) },
    { header: "Selection Basis", value: (o) => o.selectionBasis },
  ];
}

const SEGMENT_HEADER = "Segment / Type";
const RAW_SHEET = "Raw Data";

/** CSV cells that start with = + - @ are neutralised so a spreadsheet never runs an outlet name as a formula. */
function cell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function reckittCsv(report: ReckittReport): string {
  const columns = reckittColumns(report.months.map((m) => m.label));
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const outlet of report.outlets) lines.push(columns.map((c) => cell(c.value(outlet))).join(","));
  return lines.join("\r\n");
}

export function reckittFileStem(report: ReckittReport): string {
  const last = new Date(report.window.end.getTime() - 86_400_000);
  return `reckitt-universe-${last.getUTCFullYear()}-${String(last.getUTCMonth() + 1).padStart(2, "0")}`;
}

type SheetCell = string | number | { t: "n"; v: number; f?: string };
const count = (v: number, f?: string): SheetCell => ({ t: "n", v, ...(f ? { f } : {}) });

interface Layout {
  grid: SheetCell[][];
  merges: XLSX.Range[];
  columns: Column[];
}

const rawColumn = (columns: Column[], name: string) => {
  const index = columns.findIndex((c) => c.header === name);
  if (index < 0) throw new Error(`Unknown Reckitt column ${name}`);
  const letter = columnLetter(index);
  return `'${RAW_SHEET}'!$${letter}:$${letter}`;
};

/** One summary table with its title row at (zero-based) `top` and its labels in column `left`; returns the zero-based row of its Grand Total line.
 *  `groupColumn` is the Raw Data column the rows are counted by; `classification` narrows to one class; `scope` narrows to the Reckitt selection or to the active shops;
 *  `weighted` sums the shops' Outlets Merged (system outlets) instead of counting shops. */
type Scope = "all" | "selected" | "active";

function placeTable(layout: Layout, top: number, left: number, t: ReckittTable, groupColumn: string, classification: "Direct" | "Indirect" | null, scope: Scope, weighted = false): number {
  const { grid, merges, columns } = layout;
  const put = (r: number, c: number, value: SheetCell) => {
    grid[r] ??= [];
    grid[r][c] = value;
  };
  const tenureCol = rawColumn(columns, "Buying Tenure");
  const classCol = rawColumn(columns, "Direct vs Indirect");
  const selectedCol = rawColumn(columns, "Reckitt Selected");
  const activeCol = rawColumn(columns, "Active (90 days)");
  const mergedCol = rawColumn(columns, "Outlets Merged");
  const group = rawColumn(columns, groupColumn);
  put(top, left + 1, t.title);
  merges.push({ s: { r: top, c: left + 1 }, e: { r: top, c: left + RECKITT_TENURES.length + 1 } });
  put(top + 1, left, t.rowHeader);
  RECKITT_TENURES.forEach((c, i) => put(top + 1, left + 1 + i, c));
  const totalColumn = left + 1 + RECKITT_TENURES.length;
  put(top + 1, totalColumn, "Total Distinct Coverage");

  const first = top + 2;
  const labelCol = columnLetter(left);
  const extra = `${classification ? `,${classCol},"${classification}"` : ""}${scope === "selected" ? `,${selectedCol},"Yes"` : ""}${scope === "active" ? `,${activeCol},"Yes"` : ""}`;
  t.rows.forEach((row, i) => {
    const r = first + i;
    put(r, left, row.label);
    RECKITT_TENURES.forEach((tenure, k) => {
      const letter = columnLetter(left + 1 + k);
      put(r, left + 1 + k, count(row.counts[tenure], `${weighted ? `SUMIFS(${mergedCol},` : "COUNTIFS("}${group},$${labelCol}${r + 1},${tenureCol},${letter}$${top + 2}${extra})`));
    });
    const a = columnLetter(left + 1);
    const b = columnLetter(left + RECKITT_TENURES.length);
    put(r, totalColumn, count(row.total, `SUM(${a}${r + 1}:${b}${r + 1})`));
  });
  const totalRow = first + t.rows.length;
  put(totalRow, left, t.total.label);
  RECKITT_TENURES.forEach((tenure, k) => {
    const letter = columnLetter(left + 1 + k);
    put(totalRow, left + 1 + k, count(t.total.counts[tenure], `SUM(${letter}${first + 1}:${letter}${totalRow})`));
  });
  const totalLetter = columnLetter(totalColumn);
  put(totalRow, totalColumn, count(t.total.total, `SUM(${totalLetter}${first + 1}:${totalLetter}${totalRow})`));
  return totalRow;
}

/** One universe's four blocks: total by segment, Direct and Indirect side by side by segment, then by region. Returns the next free row. */
function placeUniverse(layout: Layout, top: number, tables: UniverseTables, scope: Scope): number {
  const allEnd = placeTable(layout, top, 1, tables.all, SEGMENT_HEADER, null, scope);
  const segmentTop = allEnd + 3;
  const segmentEnd = placeTable(layout, segmentTop, 1, tables.directSegment, SEGMENT_HEADER, "Direct", scope);
  placeTable(layout, segmentTop, 8, tables.indirectSegment, SEGMENT_HEADER, "Indirect", scope);
  const regionTop = segmentEnd + 3;
  const regionEnd = placeTable(layout, regionTop, 1, tables.directRegion, "Region", "Direct", scope);
  placeTable(layout, regionTop, 8, tables.indirectRegion, "Region", "Indirect", scope);
  return regionEnd + 4;
}

const WINDOW_RULES = [
  "Once in 6 Months: shops that bought at least once in the past 6 months from the current month, but not in the last 3 months.",
  "Once in 3 Months: shops that bought at least once in the past 3 months from the current month, but not in every month.",
  "Once Per Month: shops buying at least once every month in the 6 month range (the month in progress counts from its first day).",
  "Total Distinct Coverage: the distinct count of shops within the 6 month range, out of the three split tenures. Each shop is counted once, in the strictest tenure it kept up.",
];

function definitions(report: ReckittReport): string[][] {
  const { window, outlets } = report;
  const last = new Date(window.end.getTime() - 86_400_000).toISOString().slice(0, 10);
  const selected = outlets.filter((o) => o.selected).length;
  const active = outlets.filter((o) => o.active).length;
  return [
    ["Reckitt Universe: definition of terms"],
    [`Window: ${window.label} (${window.start.toISOString().slice(0, 10)} to ${last}), ${RECKITT_WINDOW_MONTHS} calendar months ending with the current one. Built ${report.generatedAt.slice(0, 16).replace("T", " ")} UTC.`],
    [`${outlets.length.toLocaleString("en-US")} shops bought in the window (built from ${report.systemOutlets.toLocaleString("en-US")} system outlets, ${report.duplicatesMerged.toLocaleString("en-US")} merged as duplicates). ${active.toLocaleString("en-US")} of them are Active (bought in the last 90 days). ${selected.toLocaleString("en-US")} are selected for Reckitt.`],
    [""],
    ["Buying tenures"],
    ...WINDOW_RULES.map((rule) => [rule]),
    [""],
    ["Direct vs Indirect: all Primary Sales is Direct and everything else is Indirect (Secondary Sales). It is the role of the shop's Absolute Principal, the principal with the largest sales there; a shop that is Primary + Secondary on it counts as Primary. This is the Primary / Secondary rule of the Active Outlets module."],
    ["Segment / Type (highlighted): the segment restructured from the source system's own Segment Name (Source Segment / Type). A shop that shares a name with others takes the segment of its highest-selling row (as in the Active Outlets extract), and the segment names are then grouped:"],
    ...Object.entries(SEGMENT_GROUPS).filter(([, members]) => members.length > 1).map(([group, members]) => [`  ${group}: ${members.join(", ")}`]),
    ["  Baby Shop, Beauty Shop, Liquor Shops, Pharmacies, Institutions and Export keep their own name. A segment in no group is kept as the source gave it. Segment Restructured says Yes where Segment / Type differs from Source Segment / Type."],
    ["Entire universe: every shop that bought in the window, selected or not. The Summary shows it first, then the active universe, then the part selected for Reckitt."],
    ["Active universe: the shops that bought in the last 90 days, grouped by buying tenure like the entire universe (a shop active in the last 90 days has bought in the last 3 months or so, so it is Once in 3 Months or Once Per Month; Once in 6 Months holds only the few whose purchases fall just outside the last 3 calendar months). Its last table counts system outlets rather than distinct shops, Direct and Indirect, which is how the Outlet Cleanup module's Active outlets tile counts; that tile judges each outlet on its own last purchase, so it can differ from this by a little."],
    [`Selected for Reckitt: a shop in a segment Reckitt can sell into (${RECKITT_SEGMENTS.join(", ")}) whose combined average spend per purchase is above KSh ${RECKITT_WHOLESALE_MIN.toLocaleString("en-US")} for a wholesaler or above KSh ${RECKITT_RETAIL_MIN.toLocaleString("en-US")} for any other segment, except that ${RECKITT_RELEVANT_SEGMENTS.join(", ")} are the direct suites by relevance and are always selected, whatever they spend. The call strike rate and the outlet location / shopper profile are not applied: they are not measured per outlet in this extract. Selection Basis says why each shop is in or out.`],
    ["Active (90 days): bought in the last 90 days, the Active Outlets module's activity window. Dormant shops (bought in the window but not in the last 90 days) are included; filter this column to see only active ones."],
    ["Shop: one row is one shop. Outlets that are the same shop, within and across systems, are merged under their master outlet (Shop ID, Outlets Merged, Systems and Merged Outlets say which) and their purchase days are united, so a day two of them bought on counts once."],
    ["Purchases come from the same feeds as the Active Outlet universe: Pine sales and orders, Leverage invoices, EABL DMS productive calls and Upfield DataEdge sales. Purchase feeds start at different dates (Pine and Upfield January 2026, EABL May 2026, Leverage June 2026), so a window reaching back before a feed began shows its shops as buying in fewer months."],
    ["The Summary sheet is made of COUNTIFS formulas over the Raw Data sheet: filter or edit the data and the summary follows."],
  ];
}

/** Adds the yellow fill to the Segment / Type column of the Raw Data sheet by editing the written file (the workbook library cannot style cells). */
function highlightSegmentColumn(file: Buffer, rawSheetIndex: number, columnIndex: number): Buffer {
  const files = unzipSync(new Uint8Array(file));
  const sheetPath = `xl/worksheets/sheet${rawSheetIndex}.xml`;
  if (!files[sheetPath] || !files["xl/styles.xml"]) return file;
  files["xl/styles.xml"] = strToU8(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  );
  const letter = columnLetter(columnIndex);
  const cellStart = new RegExp(`<c r="${letter}(\\d+)"`, "g");
  files[sheetPath] = strToU8(strFromU8(files[sheetPath]).replace(cellStart, `<c r="${letter}$1" s="1"`));
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function reckittWorkbook(report: ReckittReport): Buffer {
  const { outlets, window } = report;
  const columns = reckittColumns(report.months.map((m) => m.label));
  const summary = buildReckittSummary(outlets);
  const layout: Layout = { grid: [[], []], merges: [], columns };
  layout.grid[0][1] = `Reckitt Universe: ${window.label}`;
  layout.grid[1][1] = `${outlets.length.toLocaleString("en-US")} shops bought in the window (${report.systemOutlets.toLocaleString("en-US")} system outlets, ${report.duplicatesMerged.toLocaleString("en-US")} merged as duplicates). Each shop is counted once, in the strictest buying tenure it kept up. See Definition Of Terms.`;

  // The entire universe, then the part selected for Reckitt.
  const entireTop = 3;
  const entireEnd = placeUniverse(layout, entireTop, summary.entire, "all");
  layout.grid[entireTop - 1] ??= [];
  layout.grid[entireTop - 1][1] = "ENTIRE UNIVERSE: every shop that bought in the window";

  // The active universe: the shops that bought in the last 90 days, by buying tenure, then counted in system outlets as the dashboard's Active outlets tile does.
  const activeTop = entireEnd + 1;
  layout.grid[activeTop - 1] ??= [];
  layout.grid[activeTop - 1][1] = "ACTIVE UNIVERSE: the shops that bought in the last 90 days (the dashboard's Active outlets)";
  const activeTablesEnd = placeUniverse(layout, activeTop, summary.active, "active");
  const activeOutletsEnd = placeTable(layout, activeTablesEnd, 1, summary.activeOutlets, "Direct vs Indirect", null, "active", true);
  const selectedTop = activeOutletsEnd + 5;
  layout.grid[selectedTop - 1] ??= [];
  layout.grid[selectedTop - 1][1] = "SELECTED FOR RECKITT: the segments Reckitt can stock, above the spend per purchase thresholds";
  const selectedEnd = placeUniverse(layout, selectedTop, summary.selected, "selected");

  // Recommended coverage for Reckitt: the selected shops by segment, Direct and Indirect.
  const recTop = selectedEnd;
  const put = (r: number, c: number, value: SheetCell) => {
    layout.grid[r] ??= [];
    layout.grid[r][c] = value;
  };
  const segmentCol = rawColumn(columns, SEGMENT_HEADER);
  const classCol = rawColumn(columns, "Direct vs Indirect");
  const selectedCol = rawColumn(columns, "Reckitt Selected");
  put(recTop, 1, "Recommended coverage for Reckitt");
  layout.merges.push({ s: { r: recTop, c: 1 }, e: { r: recTop, c: 4 } });
  ["Segment / Type", "Direct", "Indirect", "Total Distinct Coverage"].forEach((h, i) => put(recTop + 1, 1 + i, h));
  summary.recommended.forEach((row, i) => {
    const r = recTop + 2 + i;
    put(r, 1, row.label);
    put(r, 2, count(row.direct, `COUNTIFS(${segmentCol},$B${r + 1},${classCol},"Direct",${selectedCol},"Yes")`));
    put(r, 3, count(row.indirect, `COUNTIFS(${segmentCol},$B${r + 1},${classCol},"Indirect",${selectedCol},"Yes")`));
    put(r, 4, count(row.total, `SUM(C${r + 1}:D${r + 1})`));
  });
  const recTotal = recTop + 2 + summary.recommended.length;
  put(recTotal, 1, "Grand Total");
  const first = recTop + 3;
  (["C", "D", "E"] as const).forEach((letter, i) => {
    const v = i === 0 ? summary.recommended.reduce((s, r) => s + r.direct, 0) : i === 1 ? summary.recommended.reduce((s, r) => s + r.indirect, 0) : summary.recommended.reduce((s, r) => s + r.total, 0);
    put(recTotal, 2 + i, count(v, `SUM(${letter}${first}:${letter}${recTotal})`));
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(layout.grid.map((row) => Array.from(row ?? [], (v) => (v === undefined ? null : v))) as unknown as unknown[][]);
  summarySheet["!merges"] = layout.merges;
  summarySheet["!cols"] = [{ wch: 3 }, { wch: 24 }, ...Array.from({ length: 12 }, () => ({ wch: 17 }))];

  // Dense mode and a compressed zip, as in the frequency extract: about 60,000 rows as a sparse sheet in an uncompressed zip would run to hundreds of megabytes.
  const dataSheet = XLSX.utils.aoa_to_sheet([columns.map((c) => c.header), ...outlets.map((o) => columns.map((c) => c.value(o)))], { dense: true } as XLSX.AOA2SheetOpts);
  dataSheet["!cols"] = columns.map((c) => ({ wch: Math.max(12, Math.min(34, c.header.length + 2)) }));
  dataSheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, outlets.length), c: columns.length - 1 } }) };

  const terms = XLSX.utils.aoa_to_sheet(definitions(report));
  terms["!cols"] = [{ wch: 170 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, dataSheet, RAW_SHEET);
  XLSX.utils.book_append_sheet(workbook, terms, "Definition Of Terms");
  const written = XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
  return highlightSegmentColumn(written, 2, columns.findIndex((c) => c.header === SEGMENT_HEADER));
}
