// The "Primary vs Secondary" sheet of the Purchases workbook: the monthly trend, months across, with Totals and Average columns, for the whole selection and for each brand.
// Primary = purchases (stock received from suppliers, net of returns and credits); Secondary = actual monthly sales; each in cases and in value, with Primary compared to Secondary.
import type ExcelJS from "exceljs";
import { FONT, NAVY, setTitle } from "../excelTables";
import { CANONICAL_MONTHS } from "../timeIntelligence";
import { activeMonthCount, primaryShareOfSecondary, sumOf, type Trend, type TrendBlock } from "./trend";

const LINE = { style: "thin" as const, color: { argb: "FF7030A0" } };
const BORDER = { top: LINE, left: LINE, bottom: LINE, right: LINE };
const LABEL_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFD9E1F2" } };
const TOTAL_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFDDEBF7" } };
const TITLE_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: NAVY } };

const FORMATS = { cases: "#,##0;[Red]-#,##0", value: "#,##0;[Red]-#,##0", pct: "0.0%" } as const;
type Kind = keyof typeof FORMATS;

const FIRST_MONTH_COLUMN = 3;

function writeValue(ws: ExcelJS.Worksheet, row: number, col: number, value: number | null, kind: Kind, fill?: typeof TOTAL_FILL): void {
  const cell = ws.getCell(row, col);
  cell.value = value === null ? null : kind === "pct" ? value / 100 : value;
  cell.numFmt = FORMATS[kind];
  cell.font = { name: FONT, size: 10 };
  cell.border = BORDER;
  cell.alignment = { horizontal: "right" };
  if (fill) cell.fill = fill;
}

function writeLabel(ws: ExcelJS.Worksheet, row: number, text: string): void {
  const cell = ws.getCell(row, 2);
  cell.value = text;
  cell.font = { name: FONT, size: 10 };
  cell.border = BORDER;
}

/** A group label in column A, merged down the rows it covers. */
function groupLabel(ws: ExcelJS.Worksheet, first: number, last: number, text: string): void {
  if (last > first) ws.mergeCells(first, 1, last, 1);
  const cell = ws.getCell(first, 1);
  cell.value = text;
  cell.font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } };
  cell.fill = LABEL_FILL;
  cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  for (let r = first; r <= last; r += 1) ws.getCell(r, 1).border = BORDER;
}

interface RowSpec {
  label: string;
  values: number[];
  kind: Kind;
  /** The Totals cell, where it is not simply the sum of the months (a percentage). */
  total?: number | null;
  /** Averaged across the months that have activity; off for percentages. */
  average?: boolean;
  /** The "Primary % of Secondary" column, on the primary rows. */
  share?: number | null;
}

function writeRow(ws: ExcelJS.Worksheet, row: number, spec: RowSpec, activeMonths: number, columns: { total: number; average: number; share: number }): void {
  writeLabel(ws, row, spec.label);
  spec.values.forEach((value, index) => writeValue(ws, row, FIRST_MONTH_COLUMN + index, spec.kind === "pct" ? (Number.isFinite(value) ? value : null) : value, spec.kind));
  const total = spec.total !== undefined ? spec.total : sumOf(spec.values);
  writeValue(ws, row, columns.total, total, spec.kind, TOTAL_FILL);
  writeValue(ws, row, columns.average, spec.average === false || total === null ? null : (total as number) / Math.max(1, activeMonths), spec.kind);
  writeValue(ws, row, columns.share, spec.share === undefined ? null : spec.share, "pct");
}

/** The per-month percentage of primary to secondary; a month with no secondary sales has nothing to compare with, so it is left empty. */
const monthlyShare = (primary: number[], secondary: number[]): (number | null)[] => primary.map((p, i) => primaryShareOfSecondary(p, secondary[i]));

function writeBlock(ws: ExcelJS.Worksheet, top: number, block: TrendBlock, columns: { total: number; average: number; share: number; last: number }, full: boolean): number {
  const active = activeMonthCount(block);
  const titleCell = ws.getCell(top, 1);
  ws.mergeCells(top, 1, top, columns.last);
  titleCell.value = block.label;
  titleCell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = TITLE_FILL;
  let row = top + 1;

  const pCases = sumOf(block.primaryCases);
  const pValue = sumOf(block.primaryValue);
  const sCases = sumOf(block.secondaryCases);
  const sValue = sumOf(block.secondaryValue);

  const asNumbers = (values: (number | null)[]) => values.map((v) => (v === null ? NaN : v));

  groupLabel(ws, row, row + 1, "Primary");
  writeRow(ws, row, { label: "Cases", values: block.primaryCases, kind: "cases", share: primaryShareOfSecondary(pCases, sCases) }, active, columns);
  writeRow(ws, row + 1, { label: "Value", values: block.primaryValue, kind: "value", share: primaryShareOfSecondary(pValue, sValue) }, active, columns);
  row += 2;
  if (full) row += 1;

  groupLabel(ws, row, row + 1, "Secondary");
  writeRow(ws, row, { label: "Cases", values: block.secondaryCases, kind: "cases" }, active, columns);
  writeRow(ws, row + 1, { label: "Value", values: block.secondaryValue, kind: "value" }, active, columns);
  row += 2;
  if (full) row += 1;

  if (full) {
    groupLabel(ws, row, row + 3, "Primary vs Secondary");
    writeRow(ws, row, { label: "Cases: primary % of secondary", values: asNumbers(monthlyShare(block.primaryCases, block.secondaryCases)), kind: "pct", total: primaryShareOfSecondary(pCases, sCases), average: false }, active, columns);
    writeRow(ws, row + 1, { label: "Value: primary % of secondary", values: asNumbers(monthlyShare(block.primaryValue, block.secondaryValue)), kind: "pct", total: primaryShareOfSecondary(pValue, sValue), average: false }, active, columns);
    writeRow(ws, row + 2, { label: "Cases: primary less secondary", values: block.primaryCases.map((v, i) => v - block.secondaryCases[i]), kind: "cases" }, active, columns);
    writeRow(ws, row + 3, { label: "Value: primary less secondary", values: block.primaryValue.map((v, i) => v - block.secondaryValue[i]), kind: "value" }, active, columns);
    row += 4;
  } else {
    groupLabel(ws, row, row, "vs");
    writeRow(ws, row, { label: "Value: primary % of secondary", values: asNumbers(monthlyShare(block.primaryValue, block.secondaryValue)), kind: "pct", total: primaryShareOfSecondary(pValue, sValue), average: false }, active, columns);
    row += 1;
  }
  return row + 1;
}

export function addTrendSheet(wb: ExcelJS.Workbook, trend: Trend, subtitle: string): void {
  const ws = wb.addWorksheet("Primary vs Secondary", { properties: { tabColor: { argb: "FF7030A0" } } });
  const monthCount = trend.months.length;
  const columns = { total: FIRST_MONTH_COLUMN + monthCount, average: FIRST_MONTH_COLUMN + monthCount + 1, share: FIRST_MONTH_COLUMN + monthCount + 2, last: FIRST_MONTH_COLUMN + monthCount + 2 };
  const sameYear = new Set(trend.months.map((m) => m.year)).size <= 1;

  setTitle(ws, 1, "Primary vs Secondary: monthly trend", 14);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { name: FONT, size: 10, color: { argb: "FF5B6B80" } };
  const note = ws.getCell(3, 1);
  note.value = "Primary = purchases: stock received from suppliers, net of returns and credits (empties left out). Secondary = actual monthly sales (invoices less credit notes, excl. VAT). Average is taken across the months that have activity.";
  note.font = { name: FONT, size: 9, italic: true, color: { argb: "FF5B6B80" } };

  const header = 5;
  const headerCells: [number, string][] = [
    ...trend.months.map((m, index): [number, string] => [FIRST_MONTH_COLUMN + index, sameYear ? CANONICAL_MONTHS[m.monthIndex] : `${CANONICAL_MONTHS[m.monthIndex]} ${m.year}`]),
    [columns.total, "Totals"],
    [columns.average, "Average"],
    [columns.share, "Primary % of Secondary"],
  ];
  for (const [col, text] of headerCells) {
    const cell = ws.getCell(header, col);
    cell.value = text;
    cell.font = { name: FONT, size: 10, bold: true };
    cell.border = BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    if (col >= columns.total) cell.fill = TOTAL_FILL;
  }
  ws.getRow(header).height = 30;

  let row = writeBlock(ws, header + 1, trend.total, columns, true);
  if (trend.byBrand.length > 0 && !(trend.byBrand.length === 1 && trend.byBrand[0].label === trend.total.label)) {
    const heading = ws.getCell(row, 1);
    heading.value = "By brand";
    heading.font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
    row += 1;
    for (const block of trend.byBrand) row = writeBlock(ws, row, block, columns, false);
  }

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 30;
  for (let col = FIRST_MONTH_COLUMN; col < columns.total; col += 1) ws.getColumn(col).width = 14;
  ws.getColumn(columns.total).width = 16;
  ws.getColumn(columns.average).width = 15;
  ws.getColumn(columns.share).width = 17;
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: header, showGridLines: false }];
}
