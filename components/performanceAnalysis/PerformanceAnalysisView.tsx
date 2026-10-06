"use client";

import { useState } from "react";
import { periodDetail, periodText } from "@/lib/performanceAnalysis/narrative";
import { GP_BASIS_LABELS, type GpBasis, type PerformanceSnapshotPayload } from "@/lib/performanceAnalysis/types";
import { CustomersSection } from "./CustomersSection";
import { GrowthSection } from "./GrowthSection";
import { ItemsSection } from "./ItemsSection";
import { MonthlySection } from "./MonthlySection";
import { OperationsSection } from "./OperationsSection";
import { PrincipalsSection } from "./PrincipalsSection";
import { SummarySection } from "./SummarySection";
import { Segmented } from "./shared";

const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "principals", label: "Principals" },
  { id: "monthly", label: "Month on month" },
  { id: "items", label: "Top items" },
  { id: "customers", label: "Customers" },
  { id: "growth", label: "Growth & GP" },
  { id: "operations", label: "Branches, reps & returns" },
];

const generatedFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export function PerformanceAnalysisView({ snapshot }: { snapshot: PerformanceSnapshotPayload }) {
  const [basis, setBasis] = useState<GpBasis>("dashboard");
  const p = snapshot[basis];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-foreground">Year-to-date performance analysis</h1>
          <p className="mt-1 max-w-[70ch] text-sm text-muted-strong">
            Pinefrost secondary sales across all principals, warehouses and routes, read from SAP. Values are net of VAT and net of credit notes, in Kenyan shillings.
          </p>
        </div>
        <div className="text-right text-[13px] text-muted">
          <b className="block text-[15px] text-foreground">{periodText(p)}</b>
          {periodDetail(p)}
          <span className="block">Built {generatedFormat.format(new Date(snapshot.generatedAt))} (Nairobi)</span>
        </div>
      </header>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1.5" aria-label="Sections">
          {SECTIONS.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-strong transition-colors hover:bg-accent-blue-soft hover:text-primary-blue">
              {section.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Gross profit basis</span>
          <Segmented
            label="Gross profit basis"
            value={basis}
            onChange={setBasis}
            options={(Object.keys(GP_BASIS_LABELS) as GpBasis[]).map((value) => ({ value, label: GP_BASIS_LABELS[value] }))}
          />
        </div>
      </div>

      <SummarySection p={p} />
      <PrincipalsSection p={p} />
      <MonthlySection p={p} />
      <ItemsSection p={p} />
      <CustomersSection p={p} />
      <GrowthSection p={p} />
      <OperationsSection p={p} />

      <footer className="border-t border-border pt-4 text-[13px] text-muted">
        Source: SAP Business One invoices and credit notes, {snapshot.lineCount.toLocaleString()} document lines, {p.kpi.customers.toLocaleString()} customer accounts, {p.kpi.skus.toLocaleString()} SKUs.
        Sales = line total excl. VAT, invoices less credit notes. {GP_BASIS_LABELS[basis]} shown.
        {snapshot.excludedLines > 0 ? ` ${snapshot.excludedLines.toLocaleString()} lines (KES ${(snapshot.excludedSales / 1e6).toFixed(1)}M) belong to items with no active principal and are left out, as they are on Sales Performance.` : ""}
        {p.labels.cq && p.labels.pq ? ` ${p.labels.pq} and ${p.labels.cq} are calendar quarters.` : ""}
      </footer>
    </div>
  );
}
