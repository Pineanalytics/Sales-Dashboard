"use client";

import Link from "next/link";
import { ArrowLeft20Regular, Open20Regular } from "@fluentui/react-icons";
import { EablReportTabs } from "@/components/timestamps/EablReportTabs";

export default function EablDsrReviewPage() {
  return <main className="flex h-[calc(100dvh-4.5rem)] min-h-0 w-full flex-col gap-3 overflow-hidden p-3 sm:p-4">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-[0_3px_12px_rgba(11,61,53,0.06)]">
      <div>
        <Link href="/timestamps" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-blue hover:underline"><ArrowLeft20Regular className="h-4 w-4" /> All timestamp systems</Link>
        <h1 className="mt-1 text-xl font-bold text-brand-navy">EABL DSR Review</h1>
        <p className="mt-0.5 text-xs text-muted">Daily DSR KPIs, field reports, sign-off workflow and EABL sales analytics.</p>
      </div>
      <EablReportTabs current="dsr" />
    </div>
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_8px_28px_rgba(11,61,53,0.10)]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-brand-navy px-4 py-2 text-white">
        <span className="text-xs font-semibold">EABL DSR operational workspace</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-white/70"><Open20Regular className="h-3.5 w-3.5" /> Protected inside Sales Dashboard</span>
      </div>
      <iframe title="EABL DSR Review" src="/api/eabl-dsr-review/dsr/dashboard" className="min-h-0 flex-1 w-full bg-background" />
    </section>
  </main>;
}
