import type { ReactNode } from "react";

/** Responsive KPI card grid: 1-col below 560px, 2-col below 768px, more on desktop. 24px card gutters per spec. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 min-[560px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">{children}</div>;
}

export function SectionCard({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.14)] hover:-translate-y-0.5">
      {title || action ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title ? <h3 className="text-lg font-semibold text-primary-blue">{title}</h3> : <span />}
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
