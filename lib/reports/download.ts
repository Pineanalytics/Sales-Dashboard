// Shared by ReportCatalog (the /reports hub) and InlineReportExport (the
// per-page "extract" button) — both trigger the exact same Excel/PDF blob
// download, just from a different filter source (a local, re-pickable copy
// on /reports vs. the live global filters everywhere else).
import type { PeriodSelection } from "@/lib/timeIntelligence";

export function periodLabelFor(period: PeriodSelection): string {
  if (period.kind === "H1" || period.kind === "H2" || period.kind.startsWith("Q")) return `${period.kind} ${period.year}`;
  return `${period.kind} ${period.month ?? ""} ${period.year}`.replace(/\s+/g, " ").trim();
}

export function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
