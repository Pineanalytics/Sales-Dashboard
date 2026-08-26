"use client";

import Link from "next/link";
import { ClipboardTaskListLtr20Regular, Timer20Regular } from "@fluentui/react-icons";

const tabs = [
  { key: "calls", label: "EABL Call Performance", href: "/timestamps/eabl-call-performance", icon: Timer20Regular },
  { key: "dsr", label: "EABL DSR Review", href: "/timestamps/eabl-call-performance/dsr-review", icon: ClipboardTaskListLtr20Regular },
] as const;

export function EablReportTabs({ current }: { current: "calls" | "dsr" }) {
  return <nav aria-label="EABL reports" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-background-elevated/60 p-1">
    {tabs.map((tab) => {
      const Icon = tab.icon;
      const active = tab.key === current;
      return <Link key={tab.key} href={tab.href} aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${active ? "bg-primary-blue text-white shadow-sm" : "text-brand-navy hover:bg-surface"}`}><Icon className="h-4 w-4" />{tab.label}</Link>;
    })}
  </nav>;
}
