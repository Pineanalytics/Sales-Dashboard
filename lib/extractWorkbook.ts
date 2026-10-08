// Writes a BrandCustomerExtract (lib/brandCustomerExtract.ts) to an .xlsx buffer. Server-side: the raw sheet can
// run to tens of thousands of rows, which is too heavy to assemble in the browser.
import * as XLSX from "xlsx";
import type { ExtractSheet } from "./brandCustomerExtract";

/** Excel caps sheet names at 31 characters and forbids \ / ? * [ ]. */
function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
}

const MONEY = "#,##0.00";
const VOLUME = "#,##0.0";
const PERCENT = "0.0";

/** Number format for a column, by its header. Percent columns hold the percentage itself (8.1 means 8.1%). */
function formatFor(header: string): string | null {
  if (header.includes("%")) return PERCENT;
  if (/^(Revenue|Gross Profit|Prior-Year Revenue|Avg Monthly Revenue)/.test(header)) return MONEY;
  if (header.startsWith("Cases")) return VOLUME;
  return null;
}

function widthFor(sheet: ExtractSheet, col: number): number {
  let longest = sheet.columns[col].length;
  for (let i = 0; i < Math.min(sheet.rows.length, 200); i++) {
    const cell = sheet.rows[i][col];
    const length = typeof cell === "number" ? 14 : String(cell ?? "").length;
    if (length > longest) longest = length;
  }
  return Math.min(48, Math.max(9, longest + 2));
}

export function extractToXlsxBuffer(sheets: ExtractSheet[]): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);
    ws["!cols"] = sheet.columns.map((_, col) => ({ wch: widthFor(sheet, col) }));
    if (sheet.name !== "Summary" && sheet.columns.length > 0) {
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sheet.rows.length, c: sheet.columns.length - 1 } }) };
    }
    sheet.columns.forEach((header, col) => {
      const format = formatFor(header);
      if (!format) return;
      for (let row = 1; row <= sheet.rows.length; row++) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })];
        if (cell && cell.t === "n") cell.z = format;
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, sheetName(sheet.name));
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
