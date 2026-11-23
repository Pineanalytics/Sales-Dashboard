"use client";

import { ArrowLeft20Regular, ShieldCheckmark16Regular } from "@fluentui/react-icons";
import { EablReportTabs } from "@/components/timestamps/EablReportTabs";
import type { TimestampsModule } from "./types";

// The workspace is an embedded app, so it should own the screen: one slim toolbar (back, title, report tabs) above it
// instead of a tall header card plus a second title strip, and a height that follows the window (the module bar, page
// header and toolbar take ~13rem) rather than a fixed 80vh that left a gap on tall screens and clipped on short ones.
export function EablDsrReviewView({ onNavigate }: { onNavigate: (key: TimestampsModule) => void }) {
  return <div className="flex h-[calc(100dvh-13rem)] min-h-[520px] w-full flex-col gap-2 overflow-hidden">
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-[0_2px_8px_rgba(11,61,53,0.08)]">
      <button type="button" onClick={() => onNavigate("pine")} title="All timestamp systems" aria-label="Back to all timestamp systems" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary-blue transition-colors hover:bg-accent-blue-soft"><ArrowLeft20Regular className="h-5 w-5" /></button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-bold leading-tight text-brand-navy">EABL DSR Review</h1>
        <p className="truncate text-[11px] leading-tight text-muted">Daily DSR KPIs, field reports, sign-off workflow and EABL sales analytics</p>
      </div>
      <span className="hidden items-center gap-1 rounded-full bg-accent-blue-soft px-2.5 py-1 text-[11px] font-semibold text-primary-blue lg:inline-flex" title="Served through Sales Dashboard; sign-in and access follow your dashboard session"><ShieldCheckmark16Regular className="h-3.5 w-3.5" /> Protected</span>
      <EablReportTabs current="dsr" onNavigate={(key) => onNavigate(key === "calls" ? "eabl-calls" : "eabl-dsr")} />
    </div>
    <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background shadow-[0_4px_16px_rgba(11,61,53,0.08)]">
      <iframe title="EABL DSR Review" src="/api/eabl-dsr-review/dsr/dashboard" className="h-full w-full bg-background" />
    </section>
  </div>;
}
