import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import type { ReportContent } from "./types";

// Pinefrost brand hex values (mirrors app/globals.css's --dark-navy/--primary-blue —
// duplicated here rather than imported since this runs outside any CSS-variable
// context, same rationale as every other cross-subtree color duplication in this repo).
const NAVY: [number, number, number] = [10, 31, 82];
const ROYAL_BLUE: [number, number, number] = [21, 61, 154];
const PAGE_MARGIN = 40;

/** Generic ReportContent -> PDF Blob using jspdf + jspdf-autotable: a navy title band,
 *  an optional KPI summary strip, then one table per section with automatic page
 *  breaks, and a page-number footer. Deliberately data-only — no chart images (see
 *  plan notes on why that's out of scope). */
export function reportToPdfBlob(report: ReportContent): Blob {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(report.title, PAGE_MARGIN, 32);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`Generated ${report.generatedAt.toLocaleString()}`, PAGE_MARGIN, 50);

  let cursorY = 90;
  doc.setTextColor(0, 0, 0);

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
      headStyles: { fillColor: ROYAL_BLUE, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 247, 251] },
      styles: { fontSize: 8, cellPadding: 4 },
    });

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - PAGE_MARGIN - 60, doc.internal.pageSize.getHeight() - 20);
  }

  return doc.output("blob");
}
