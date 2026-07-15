// Shared shape every report definition (lib/reports/definitions.ts) produces, and every
// renderer (toExcel.ts, toPdf.ts) consumes — keeps the two output formats always in sync
// with each other, since they're built from the exact same intermediate structure rather
// than each definition hand-rolling its own Excel/PDF logic.

export interface ReportSection {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportContent {
  title: string; // "Sales Performance — YTD 2026"
  generatedAt: Date;
  /** KPI strip shown at the top of the PDF and as the first rows of the Excel's first sheet. */
  summary?: { label: string; value: string }[];
  sections: ReportSection[];
}
