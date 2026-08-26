"use client";

import Link from "next/link";
import { ArrowLeft20Regular, Open20Regular } from "@fluentui/react-icons";
import { EablReportTabs } from "@/components/timestamps/EablReportTabs";
import { SfaReportNavigator } from "@/components/timestamps/SfaReportNavigator";

export default function EablDsrReviewPage() {
  return <main className="mx-auto flex max-w-[1800px] flex-col gap-4 px-3 py-4 sm:px-5 lg:px-6">
    <SfaReportNavigator current="EABL" />
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Link href="/timestamps" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-blue hover:underline"><ArrowLeft20Regular className="h-4 w-4" /> All timestamp systems</Link>
        <h1 className="mt-2 text-2xl font-bold text-brand-navy">EABL DSR Review</h1>
        <p className="mt-1 text-sm text-muted">Daily DSR KPIs, field reports, sign-off workflow and EABL sales analytics from the existing Pinefrost Analytics service.</p>
      </div>
      <EablReportTabs current="dsr" />
    </div>
    <section className="overflow-hidden rounded-2xl border border-border bg-[#071522] shadow-[0_8px_28px_rgba(11,61,53,0.12)]">
      <div className="flex items-center justify-between border-b border-white/10 bg-brand-navy px-4 py-2 text-white">
        <span className="text-xs font-semibold">EABL DSR operational workspace</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-white/70"><Open20Regular className="h-3.5 w-3.5" /> Protected inside Sales Dashboard</span>
      </div>
      <iframe title="EABL DSR Review" src="/api/eabl-dsr-review/dsr/dashboard" className="h-[calc(100vh-13rem)] min-h-[720px] w-full bg-[#071522]" />
    </section>
  </main>;
}
