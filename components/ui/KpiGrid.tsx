import type { ReactNode } from "react";

/** Responsive KPI card grid: 1-col below 560px, 2-col below 768px, more on desktop. 12px card gutters. */
export function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 min-[560px]:grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-4">{children}</div>;
}

export type CardAccent = "blue" | "green" | "red" | "amber" | "purple" | "navy";

// True red/green/amber (not this app's rebranded accent-* tokens, which resolve to
// blue/orange/cyan) — matching the reference Power BI dashboard's literal color coding
// for variance/achievement (green = ahead, red = behind, amber = borderline).
const ACCENT_BORDER: Record<CardAccent, string> = {
  blue: "border-l-primary-blue",
  green: "border-l-emerald-500",
  red: "border-l-red-500",
  amber: "border-l-amber-500",
  purple: "border-l-violet-600",
  navy: "border-l-dark-navy",
};

export function SectionCard({
  title,
  action,
  children,
  accent,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  /** Opt-in left-border accent + fixed elevation, matching the reference executive
   *  dashboard's dense KPI-panel look. Omit to keep this card's original top-border
   *  hover-lift style unchanged — every existing call site is unaffected. */
  accent?: CardAccent;
}) {
  if (accent) {
    return (
      <div
        className={`rounded-xl border-l-4 ${ACCENT_BORDER[accent]} bg-surface p-4 shadow-[0_4px_14px_rgba(11,61,53,0.10)] transition-shadow duration-300 hover:shadow-[0_8px_24px_rgba(11,61,53,0.16)]`}
      >
        {title || action ? (
          <div className="mb-2.5 flex items-center justify-between gap-2">
            {title ? (
              <h3 className="border-b border-primary-blue/25 pb-1 text-[12px] font-bold uppercase tracking-wide text-primary-blue">{title}</h3>
            ) : (
              <span />
            )}
            {action}
          </div>
        ) : null}
        {children}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border border-t-2 border-t-primary-blue bg-surface p-5 shadow-[0_2px_4px_rgba(11,61,53,0.03),0_12px_28px_rgba(11,61,53,0.04)] transition-all duration-300 hover:shadow-[0_12px_30px_rgba(11,61,53,0.1)] hover:-translate-y-0.5">
      {title || action ? (
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {title ? <h3 className="text-base font-bold tracking-[-0.02em] text-brand-navy">{title}</h3> : <span />}
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
