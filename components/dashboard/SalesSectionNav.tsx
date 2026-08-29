"use client";

import {
  ArrowTrending20Regular,
  Board20Regular,
  ChartMultiple20Regular,
  DataLine20Regular,
  PersonCircle20Regular,
} from "@fluentui/react-icons";
import { useCurrentUser } from "@/components/dashboard/UserContext";

export type SalesSection = "cockpit" | "executive" | "time" | "reps" | "customers";

export const SALES_SECTIONS: {
  id: SalesSection;
  pageKey: string;
  label: string;
  description: string;
  Icon: typeof ArrowTrending20Regular;
}[] = [
  { id: "cockpit", pageKey: "sales", label: "Sales cockpit", description: "Revenue, target and principal mix", Icon: ArrowTrending20Regular },
  { id: "executive", pageKey: "dashboard", label: "Executive", description: "MTD and YTD leadership view", Icon: Board20Regular },
  { id: "time", pageKey: "time-intelligence", label: "Time intelligence", description: "Trends, growth and comparisons", Icon: DataLine20Regular },
  { id: "reps", pageKey: "reps", label: "Rep performance", description: "People, contribution and productivity", Icon: PersonCircle20Regular },
  { id: "customers", pageKey: "customers", label: "Customers & brands", description: "Customer concentration and brand mix", Icon: ChartMultiple20Regular },
];

export function useAvailableSalesSections() {
  const user = useCurrentUser();
  return SALES_SECTIONS.filter((section) => user?.role === "ADMIN" || (user?.allowedPages ?? []).includes(section.pageKey));
}

export function SalesSectionNav({ active, onSelect }: { active: SalesSection; onSelect: (section: SalesSection) => void }) {
  const availableSections = useAvailableSalesSections();

  return (
    <section className="rounded-2xl border border-border bg-surface p-3 shadow-sm md:p-4">
      <div className="grid items-center gap-3 xl:grid-cols-[minmax(230px,0.72fr)_minmax(0,3.28fr)]">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-blue">Commercial analysis</p>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">Sales Performance</h1>
          <p className="mt-0.5 text-xs text-muted">Global period and principal filters apply to every view.</p>
        </div>
        <nav aria-label="Sales analysis sections" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {availableSections.map(({ id, label, description, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-current={active === id ? "page" : undefined}
              className={`flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${active === id ? "border-primary-blue bg-accent-blue-soft shadow-sm" : "border-border bg-surface hover:border-secondary-blue/50 hover:bg-accent-blue-soft/40"}`}
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg [&_svg]:h-4 [&_svg]:w-4 ${active === id ? "bg-primary-blue text-white" : "bg-accent-blue-soft text-secondary-blue"}`}>
                <Icon />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
                <span className="block truncate text-[10px] text-muted">{description}</span>
              </span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
