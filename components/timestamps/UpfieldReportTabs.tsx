"use client";

import Link from "next/link";
import { DataLine20Regular, VehicleCar20Regular } from "@fluentui/react-icons";

const tabs = [
  { key: "dataedge", label: "DataEdge (Sales)", href: "/timestamps/upfield-dataedge", icon: DataLine20Regular },
  { key: "visits", label: "Outlet Visits", href: "/timestamps/upfield-visits", icon: VehicleCar20Regular },
] as const;

/** Upfield DataEdge and Outlet Visits are two feeds from the same source
 * machine (F:\UpfieldSalesRawData) with two different natural grains — sales
 * documents vs. FSR check-in/check-out — so they stay separate pages/APIs.
 * Presented as one "Upfield" card on the timestamp-systems hub with this tab
 * switcher between them, same pattern as EablReportTabs for EABL's own two
 * reports, rather than two separate hub cards for one principal. */
export function UpfieldReportTabs({ current }: { current: "dataedge" | "visits" }) {
  return <nav aria-label="Upfield reports" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-background-elevated/60 p-1">
    {tabs.map((tab) => {
      const Icon = tab.icon;
      const active = tab.key === current;
      return <Link key={tab.key} href={tab.href} aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${active ? "bg-primary-blue text-white shadow-sm" : "text-brand-navy hover:bg-surface"}`}><Icon className="h-4 w-4" />{tab.label}</Link>;
    })}
  </nav>;
}
