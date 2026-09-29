import { DataLine20Regular, VehicleCar20Regular } from "@fluentui/react-icons";

const tabs = [
  { key: "dataedge", label: "DataEdge (Sales)", icon: DataLine20Regular },
  { key: "visits", label: "Outlet Visits", icon: VehicleCar20Regular },
] as const;

/** Upfield DataEdge and Outlet Visits are two feeds from the same source
 * machine (F:\UpfieldSalesRawData) with two different natural grains — sales
 * documents vs. FSR check-in/check-out — so they stay separate view
 * components/APIs. Presented as one "Upfield" card on the timestamp-systems
 * hub with this tab switcher between them, same pattern as EablReportTabs
 * for EABL's own two reports, rather than two separate hub cards for one
 * principal. */
export function UpfieldReportTabs({ current, onNavigate }: { current: "dataedge" | "visits"; onNavigate: (key: "dataedge" | "visits") => void }) {
  return <nav aria-label="Upfield reports" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-background-elevated/60 p-1">
    {tabs.map((tab) => {
      const Icon = tab.icon;
      const active = tab.key === current;
      return <button key={tab.key} type="button" onClick={() => onNavigate(tab.key)} aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${active ? "bg-primary-blue text-white shadow-sm" : "text-brand-navy hover:bg-surface"}`}><Icon className="h-4 w-4" />{tab.label}</button>;
    })}
  </nav>;
}
