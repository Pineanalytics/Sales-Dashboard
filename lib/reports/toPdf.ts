import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { ReportContent } from "./types";

// Matches the shared Pinefrost Distribution visual system. PDFs run outside CSS,
// so the values are intentionally kept explicit here.
const PINE: [number, number, number] = [11, 61, 53];
const FOREST: [number, number, number] = [31, 106, 78];
const SAGE_ROW: [number, number, number] = [237, 243, 236];
const PAGE_MARGIN = 40;

/** Converts report data into a branded, print-friendly PDF. */
export function reportToPdfBlob(report: ReportContent): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...PINE);
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(report.title, PAGE_MARGIN, 32);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Pinefrost Analytics · Generated ${report.generatedAt.toLocaleString()}`, PAGE_MARGIN, 50);

  let cursorY = 90;
  doc.setTextColor(18, 63, 55);

  if (report.summary && report.summary.length > 0) {
    doc.setFontSize(10);
    for (const s of report.summary) {
      doc.setFont("helvetica", "bold");
      doc.text(`${s.label}:`, PAGE_MARGIN, cursorY);
      doc.setFont("helvetica", "normal");
      doc.text(s.value, PAGE_MARGIN + 140, cursorY);
      cursorY += 16;
    }
    cursorY += 10;
  }

  if (report.narrative) {
    const maxWidth = pageWidth - PAGE_MARGIN * 2;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("AI Summary", PAGE_MARGIN, cursorY);
    cursorY += 14;
    doc.setFont("helvetica", "normal");
    const lines: string[] = doc.splitTextToSize(report.narrative, maxWidth);
    doc.text(lines, PAGE_MARGIN, cursorY);
    cursorY += lines.length * 13 + 12;
  }

  if (report.sections.length === 0) {
    doc.setFontSize(11);
    doc.text("No data for the current filters.", PAGE_MARGIN, cursorY);
  }

  for (const section of report.sections) {
    if (cursorY > doc.internal.pageSize.getHeight() - 100) {
      doc.addPage();
      cursorY = PAGE_MARGIN;
    }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(section.title, PAGE_MARGIN, cursorY);
    cursorY += 12;

    autoTable(doc, {
      startY: cursorY,
      margin: { left: PAGE_MARGIN, right: PAGE_MARGIN },
      head: [section.columns],
      body: section.rows,
      headStyles: { fillColor: FOREST, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: SAGE_ROW },
      styles: { fontSize: 8, cellPadding: 4 },
    });

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 117, 110);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - PAGE_MARGIN - 60, doc.internal.pageSize.getHeight() - 20);
  }

  return doc.output("blob");
}
