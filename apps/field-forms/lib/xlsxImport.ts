// Shared client-side Excel helpers for the master-data admin panels.
// Reuses `exceljs` (already a dependency for report exports, see
// lib/dashboardExcel.ts) for both directions — reading an uploaded .xlsx
// into the same Record<string,string>[] shape Papa.parse produces for CSV
// (so the existing lookup/insert logic per entity needs zero changes), and
// writing a downloadable sample template as a filling guide.
import ExcelJS from "exceljs";

export async function parseXlsxFile(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const record: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (!header) return;
      const value = cell.value;
      const str =
        value == null
          ? ""
          : typeof value === "object" && "text" in (value as object)
            ? String((value as { text: string }).text)
            : typeof value === "object" && "result" in (value as object)
              ? String((value as { result: unknown }).result ?? "")
              : String(value);
      if (str.trim()) hasValue = true;
      record[header] = str.trim();
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}

export async function downloadXlsxTemplate(
  filename: string,
  columns: string[],
  exampleRows: string[][],
  note?: string
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Template");
  sheet.addRow(columns);
  sheet.getRow(1).font = { bold: true };
  for (const row of exampleRows) sheet.addRow(row);
  if (note) {
    const noteRowIndex = exampleRows.length + 3;
    sheet.getCell(`A${noteRowIndex}`).value = note;
    sheet.getCell(`A${noteRowIndex}`).font = { italic: true, color: { argb: "FF666666" } };
  }
  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
