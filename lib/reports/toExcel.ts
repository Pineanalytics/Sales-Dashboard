import * as XLSX from "xlsx";
import type { ReportContent } from "./types";

// Excel sheet names are capped at 31 characters and can't contain \ / ? * [ ].
function sheetName(title: string): string {
  return title.replace(/[\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
}

/** Generic ReportContent -> .xlsx Blob. One sheet per section; the summary strip (if
 *  present) is written as extra rows above the first section's table on sheet 1, so a
 *  report with a summary still opens straight into its data rather than a separate
 *  "cover sheet" nobody asked for. */
export function reportToExcelBlob(report: ReportContent): Blob {
  const wb = XLSX.utils.book_new();

  report.sections.forEach((section, i) => {
    const aoa: (string | number)[][] = [];
    if (i === 0) {
      aoa.push([report.title]);
      aoa.push([`Generated ${report.generatedAt.toLocaleString()}`]);
      if (report.summary && report.summary.length > 0) {
        aoa.push([]);
        for (const s of report.summary) aoa.push([s.label, s.value]);
      }
      if (report.narrative) {
        aoa.push([]);
        aoa.push(["AI Summary"]);
        aoa.push([report.narrative]);
      }
      aoa.push([]);
    }
    aoa.push([section.title]);
    aoa.push(section.columns);
    aoa.push(...section.rows);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(section.title || `Sheet ${i + 1}`));
  });

  if (report.sections.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([[report.title], ["No data for the current filters."]]);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
  }

  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
