// Shared table-writing helpers for the formatted Excel workbooks (Performance Analysis, Purchases): a titled table with a navy header, zebra rows, optional totals row,
// money / percentage / growth number formats, and a one-table sheet with a frozen header and a filter. Money is whole shillings; a "pct" column is read in percent
// units (8.1 = 8.1%) and stored as a fraction so Excel's percent format shows it right.
import ExcelJS from "exceljs";

export type Cell = string | number | null;
export type Format = "text" | "int" | "money" | "decimal" | "pct" | "growth";

export const NUMBER_FORMATS: Record<Format, string | undefined> = {
  text: undefined,
  int: "#,##0",
  money: "#,##0;[Red]-#,##0",
  decimal: "#,##0.0;[Red]-#,##0.0",
  pct: "0.0%",
  growth: "+0.0%;[Red]-0.0%;0.0%",
};

export const NAVY = "FF1F3A5F";
export const BAND = "FFF3F6FA";
export const TITLE_RULE = "FFB8C4D6";
export const FONT = "Calibri";

export interface Column<T> {
  header: string;
  fmt?: Format;
  width?: number;
  /** A percentage column is read in percent units (8.1 = 8.1%) and written as 0.081. */
  value: (row: T, index: number) => Cell;
}

/** A cell value as the sheet stores it: percentages become fractions so Excel's % format reads them, null becomes an empty cell. */
export function stored(value: Cell, fmt: Format | undefined): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && (fmt === "pct" || fmt === "growth")) return value / 100;
  return value;
}

export function setTitle(ws: ExcelJS.Worksheet, row: number, text: string, size = 12): void {
  const cell = ws.getCell(row, 1);
  cell.value = text;
  cell.font = { name: FONT, size, bold: true, color: { argb: NAVY } };
}

/** Writes one table: a title row, a header row and the data, from `top`. Returns the first free row below it (one blank row left). */
export function writeTable<T>(ws: ExcelJS.Worksheet, top: number, title: string, columns: Column<T>[], rows: T[], options: { note?: string; totals?: (Cell | undefined)[] } = {}): { next: number; headerRow: number } {
  let row = top;
  setTitle(ws, row, title);
  row += 1;
  if (options.note) {
    const note = ws.getCell(row, 1);
    note.value = options.note;
    note.font = { name: FONT, size: 9, italic: true, color: { argb: "FF5B6B80" } };
    row += 1;
  }
  const headerRow = row;
  columns.forEach((column, index) => {
    const cell = ws.getCell(row, index + 1);
    cell.value = column.header;
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.alignment = { vertical: "middle", horizontal: column.fmt && column.fmt !== "text" ? "right" : "left", wrapText: true };
  });
  ws.getRow(row).height = 30;
  row += 1;

  rows.forEach((data, rowIndex) => {
    columns.forEach((column, index) => {
      const cell = ws.getCell(row, index + 1);
      cell.value = stored(column.value(data, rowIndex), column.fmt);
      cell.font = { name: FONT, size: 10 };
      const format = column.fmt ? NUMBER_FORMATS[column.fmt] : undefined;
      if (format) cell.numFmt = format;
      if (rowIndex % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
    });
    row += 1;
  });

  if (options.totals) {
    options.totals.forEach((value, index) => {
      const column = columns[index];
      const cell = ws.getCell(row, index + 1);
      cell.value = stored(value ?? null, column?.fmt);
      cell.font = { name: FONT, size: 10, bold: true };
      cell.border = { top: { style: "thin", color: { argb: NAVY } } };
      const format = column?.fmt ? NUMBER_FORMATS[column.fmt] : undefined;
      if (format) cell.numFmt = format;
    });
    row += 1;
  }

  columns.forEach((column, index) => {
    const sheetColumn = ws.getColumn(index + 1);
    const wanted = column.width ?? Math.min(40, Math.max(11, column.header.length + 2));
    sheetColumn.width = Math.max(sheetColumn.width ?? 0, wanted);
  });
  return { next: row + 1, headerRow };
}

/** A sheet with one table: frozen header and a filter on every column. */
export function tableSheet<T>(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, columns: Column<T>[], rows: T[], options: { totals?: (Cell | undefined)[] } = {}): void {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: NAVY } } });
  setTitle(ws, 1, title, 14);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = { name: FONT, size: 10, color: { argb: "FF5B6B80" } };
  const { headerRow } = writeTable(ws, 4, "", columns, rows, options);
  ws.getCell(4, 1).value = null;
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow, showGridLines: false }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: columns.length } };
}
