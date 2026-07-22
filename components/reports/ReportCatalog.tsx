"use client";

import { useState } from "react";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { SectionCard } from "@/components/ui/KpiGrid";
import { REPORT_DEFINITIONS, type ReportContext } from "@/lib/reports/definitions";
import { ReportFilters } from "@/components/reports/ReportFilters";
import type { Dataset } from "@/lib/types";
import type { PeriodSelection } from "@/lib/timeIntelligence";
import type { PageKey } from "@/lib/pageAccess";

interface ReportCatalogProps {
  dataset: Dataset | null;
  period: PeriodSelection;
  principalKey: string | null;
  allowedPages: string[];
  isAdmin: boolean;
}

function periodLabelFor(period: PeriodSelection): string {
  if (period.kind === "H1" || period.kind === "H2" || period.kind.startsWith("Q")) return `${period.kind} ${period.year}`;
  return `${period.kind} ${period.month ?? ""} ${period.year}`.replace(/\s+/g, " ").trim();
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Central "download the data behind any page" hub — every report reuses the exact
 *  same selector functions the live pages call, so what you download always matches
 *  what's on screen for the current period/principal filter (dataset-backed reports)
 *  or the current sync (bridge-backed reports, which have no period filter of their
 *  own — same as their live pages). */
export function ReportCatalog({ dataset, period: initialPeriod, principalKey: initialPrincipalKey, allowedPages, isAdmin }: ReportCatalogProps) {
  const [pending, setPending] = useState<string | null>(null); // `${reportKey}:${format}`
  // Local-only customization state, seeded from the live dashboard's current filters but
  // never written back to the store — see ReportFilters.tsx.
  const [period, setPeriod] = useState<PeriodSelection>(initialPeriod);
  const [principalKey, setPrincipalKey] = useState<string | null>(initialPrincipalKey);
  const [repFilter, setRepFilter] = useState<string | null>(null);

  const visible = REPORT_DEFINITIONS.filter((d) => isAdmin || allowedPages.includes(d.pageKey as PageKey));
  const periodLabel = periodLabelFor(period);

  async function handleDownload(reportKey: string, label: string, format: "excel" | "pdf") {
    const def = REPORT_DEFINITIONS.find((d) => d.key === reportKey);
    if (!def) return;
    setPending(`${reportKey}:${format}`);
    try {
      const ctx: ReportContext = { dataset, period, principalKey, repFilter, periodLabel };
      const content = await def.build(ctx);
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === "excel") {
        const { reportToExcelBlob } = await import("@/lib/reports/toExcel");
        triggerDownload(reportToExcelBlob(content), `${slugify(label)}-${stamp}.xlsx`);
      } else {
        const { reportToPdfBlob } = await import("@/lib/reports/toPdf");
        triggerDownload(reportToPdfBlob(content), `${slugify(label)}-${stamp}.pdf`);
      }
    } catch (err) {
      console.error(`Failed to generate ${label} report`, err);
    } finally {
      setPending(null);
    }
  }

  if (visible.length === 0) {
    return (
      <SectionCard title="Available Reports">
        <p className="px-4 py-6 text-sm text-muted">No reports available for your account — ask your administrator for access.</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Available Reports">
      {dataset ? (
        <ReportFilters
          dataset={dataset}
          period={period}
          principalKey={principalKey}
          repFilter={repFilter}
          onPeriodChange={setPeriod}
          onPrincipalChange={setPrincipalKey}
          onRepChange={setRepFilter}
        />
      ) : null}
      <p className="px-1 pb-3 text-xs text-muted">
        Each report reflects the customized range ({periodLabel}){principalKey ? ` and ${principalKey}` : ""}
        {repFilter ? ` and rep "${repFilter}"` : ""} above.
      </p>
      <div className="flex flex-col divide-y divide-border/60">
        {visible.map((def) => (
          <div key={def.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{def.label}</div>
              <div className="text-xs text-muted truncate">{def.description}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                icon={pending === `${def.key}:excel` ? <Spinner className="h-3.5 w-3.5" /> : <ArrowDownload20Regular className="h-4 w-4" />}
                disabled={pending !== null}
                onClick={() => handleDownload(def.key, def.label, "excel")}
              >
                Excel
              </Button>
              <Button
                variant="secondary"
                icon={pending === `${def.key}:pdf` ? <Spinner className="h-3.5 w-3.5" /> : <ArrowDownload20Regular className="h-4 w-4" />}
                disabled={pending !== null}
                onClick={() => handleDownload(def.key, def.label, "pdf")}
              >
                PDF
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
