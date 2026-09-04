import Link from "next/link";
import { ArrowRight20Regular, Clock20Regular, DataLine20Regular } from "@fluentui/react-icons";

const SYSTEMS = [
  { key: "pine", principal: "Pine", system: "SalesEdge", description: "Standard timestamp and time-management activity.", href: "/timestamps", status: "Live" },
  { key: "eabl", principal: "EABL", system: "DMS", description: "Dedicated call performance and customer visit detail.", href: "/timestamps/eabl-call-performance", status: "Live" },
  { key: "upfield-dataedge", principal: "Upfield", system: "DataEdge", description: "Transaction timestamps and productive outlet coverage.", href: "/timestamps/upfield-dataedge", status: "Live" },
  { key: "upfield-visits", principal: "Upfield", system: "Outlet Visits", description: "FSR check-in/check-out and transit time, 4x daily.", href: "/timestamps/upfield-visits", status: "Live" },
  { key: "unilever", principal: "Unilever", system: "Leverage", description: "Timestamp reporting will appear here when its feed is connected.", status: "Planned" },
] as const;

export function SfaReportNavigator({ current = "pine" }: { current?: "pine" | "eabl" | "upfield-dataedge" | "upfield-visits" }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-3 shadow-[0_4px_14px_rgba(11,61,53,0.08)] sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-blue">Timestamp systems</p><h2 className="mt-0.5 text-sm font-bold text-brand-navy">Choose the source used by each principal</h2></div>
        <span className="rounded-full bg-background-elevated px-2.5 py-1 text-[11px] font-medium text-muted">Live sources open as reports</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {SYSTEMS.map((item) => {
          const active = item.key === current;
          const content = <><div className="flex items-start justify-between gap-2"><span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${active ? "bg-white/15 text-white" : "bg-accent-blue-soft text-secondary-blue"}`}>{item.principal === "Pine" ? <Clock20Regular /> : <DataLine20Regular />}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.status === "Live" ? (active ? "bg-white/15 text-white" : "bg-accent-green-soft text-accent-green") : "bg-background-elevated text-muted"}`}>{item.status}</span></div><div className="mt-3"><p className={`text-sm font-bold ${active ? "text-white" : "text-brand-navy"}`}>{item.principal}</p><p className={`text-xs font-semibold ${active ? "text-brand-leaf" : "text-secondary-blue"}`}>{item.system}</p><p className={`mt-1.5 text-[11px] leading-4 ${active ? "text-white/75" : "text-muted"}`}>{item.description}</p></div>{item.status === "Live" ? <span className={`mt-3 inline-flex items-center gap-1 text-[11px] font-semibold ${active ? "text-white" : "text-primary-blue"}`}>{active ? "Current report" : "Open report"} {!active ? <ArrowRight20Regular className="h-3.5 w-3.5" /> : null}</span> : null}</>;
          const className = `min-h-[164px] rounded-xl border p-3 transition-colors ${active ? "border-primary-blue bg-gradient-to-br from-primary-blue to-secondary-blue" : "border-border bg-background-elevated/30"} ${item.status === "Live" && !active ? "hover:border-secondary-blue hover:bg-surface-hover" : ""}`;
          return item.status === "Live" ? <Link key={item.key} href={item.href} className={className}>{content}</Link> : <div key={item.key} className={`${className} opacity-80`}>{content}</div>;
        })}
      </div>
    </section>
  );
}
