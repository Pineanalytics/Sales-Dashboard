import type { ReactNode } from "react";

/** Responsive KPI card grid: 1-col below 560px, 2-col below 768px, more on desktop. 12px card gutters. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 min-[560px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">{children}</div>;
}

export function SectionCard({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-xl border-t-2 border-t-primary-blue bg-surface p-4 shadow-[0_1px_3px_rgba(10,31,82,0.06)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(10,31,82,0.12)] hover:-translate-y-0.5">
      {title || action ? (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title ? <h3 className="text-[15px] font-semibold text-primary-blue">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function ChartGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{children}</div>;
}
