"use client";

import { useState } from "react";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useDashboardStore } from "@/lib/store";
import { REPORT_DEFINITIONS, type ReportContext } from "@/lib/reports/definitions";
import { periodLabelFor, slugify, triggerDownload } from "@/lib/reports/download";

/** The "download what I'm looking at right now" counterpart to /reports' central
 *  catalog — same report definitions, same Excel/PDF output, but reading the
 *  live global period/principal filters directly off the store instead of a
 *  separately re-pickable local copy, so what downloads always matches what's
 *  currently on screen with zero extra steps. Renders nothing if `reportKey`
 *  doesn't match a known definition (e.g. a page with no report built yet) or
 *  the viewer's role can't see that page. */
export function InlineReportExport({
  reportKey,
  allowedPages,
  isAdmin,
  repFilter = null,
  className = "",
}: {
  reportKey: string;
  allowedPages: string[];
  isAdmin: boolean;
  repFilter?: string | null;
  className?: string;
}) {
  const dataset = useDashboardStore((s) => s.dataset);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const principalKey = useDashboardStore((s) => s.selectedPrincipalKey);
  const [pending, setPending] = useState<"excel" | "pdf" | null>(null);

  const def = REPORT_DEFINITIONS.find((d) => d.key === reportKey);
  if (!def || !(isAdmin || allowedPages.includes(def.pageKey))) return null;

  async function handleDownload(format: "excel" | "pdf") {
    if (!def) return;
    setPending(format);
    try {
      const ctx: ReportContext = { dataset, period, principalKey, repFilter, periodLabel: periodLabelFor(period) };
      const content = await def.build(ctx);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "excel") {
        const { reportToExcelBlob } = await import("@/lib/reports/toExcel");
        triggerDownload(reportToExcelBlob(content), `${slugify(def.label)}-${stamp}.xlsx`);
      } else {
        const { reportToPdfBlob } = await import("@/lib/reports/toPdf");
        triggerDownload(reportToPdfBlob(content), `${slugify(def.label)}-${stamp}.pdf`);
      }
    } catch (err) {
      console.error(`Failed to generate ${def.label} report`, err);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Button
        variant="secondary"
        className="px-2.5 py-1"
        icon={pending === "excel" ? <Spinner className="h-3 w-3" /> : <ArrowDownload20Regular className="h-3.5 w-3.5" />}
        disabled={pending !== null}
        onClick={() => handleDownload("excel")}
        title={`Download ${def.label} as Excel, for the current filters`}
      >
        Excel
      </Button>
      <Button
        variant="secondary"
        className="px-2.5 py-1"
        icon={pending === "pdf" ? <Spinner className="h-3 w-3" /> : <ArrowDownload20Regular className="h-3.5 w-3.5" />}
        disabled={pending !== null}
        onClick={() => handleDownload("pdf")}
        title={`Download ${def.label} as PDF, for the current filters`}
      >
        PDF
      </Button>
    </div>
  );
}
