import Papa from "papaparse";

export interface ReportMeta {
  brandName: string;
  reportTitle: string;
  reportRef: string;
  generatedAt: string;
  generatedBy: string;
  periodLabel?: string;
  filtersLabel?: string;
}

export function exportToCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = Papa.unparse({ fields: headers, data: rows });
  downloadBlob(csv, filename, "text/csv;charset=utf-8;");
}

export async function exportToExcel(
  filename: string,
  sheetName: string,
  headers: string[],
  rows: (string | number)[][],
  meta: ReportMeta
) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.generatedBy;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow([meta.brandName]);
  sheet.addRow([meta.reportTitle]);
  sheet.addRow([`Ref: ${meta.reportRef}`, `Generated: ${meta.generatedAt}`, `By: ${meta.generatedBy}`]);
  if (meta.filtersLabel) sheet.addRow([`Filters: ${meta.filtersLabel}`]);
  sheet.addRow([]);
  const headerRowIdx = sheet.rowCount + 1;
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1FB" } };
  });
  for (const row of rows) sheet.addRow(row);
  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  sheet.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: headers.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    buffer as ArrayBuffer,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

export async function exportToPdf(
  filename: string,
  headers: string[],
  rows: (string | number)[][],
  meta: ReportMeta
) {
  const { default: jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text(meta.brandName, 14, 14);
  doc.setFontSize(11);
  doc.text(meta.reportTitle, 14, 21);
  doc.setFontSize(9);
  doc.text(`Ref: ${meta.reportRef}    Generated: ${meta.generatedAt}    By: ${meta.generatedBy}`, 14, 27);
  if (meta.filtersLabel) doc.text(`Filters: ${meta.filtersLabel}`, 14, 32);

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map(String)),
    startY: meta.filtersLabel ? 37 : 32,
    styles: { fontSize: 7 },
    headStyles: { fillColor: [31, 56, 100] },
    didDrawPage: () => {
      const pageCount = doc.getNumberOfPages();
      const pageSize = doc.internal.pageSize;
      doc.setFontSize(8);
      doc.text(
        `Page ${doc.getCurrentPageInfo().pageNumber} of ${pageCount}`,
        pageSize.getWidth() - 30,
        pageSize.getHeight() - 8
      );
      doc.text("Confidential — internal use only", 14, pageSize.getHeight() - 8);
    },
  });

  doc.save(filename);
}

function downloadBlob(content: string | ArrayBuffer, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
