import type { ReactNode } from "react";
import { Money20Regular, Target20Regular, ArrowTrending20Regular, PeopleTeam20Regular, ChartMultiple20Regular } from "@fluentui/react-icons";
import type { KpiAccent } from "@/lib/format";
import { kpiAccentBorderClass, kpiAccentIconClass } from "@/lib/format";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  accent?: KpiAccent;
  /** Overrides the accent's default icon. Pass `null` to hide the icon entirely. */
  icon?: ReactNode | null;
  /** "lg" (default) is the 42px numeric KPI style; "md" suits longer text values (names, status labels, gauges). */
  size?: "lg" | "md";
}

const VALUE_SIZE_CLASS = {
  lg: "text-[42px] leading-tight",
  md: "text-2xl leading-snug",
} as const;

const ACCENT_ICON: Record<KpiAccent, typeof Money20Regular> = {
  revenue: Money20Regular,
  mission: Target20Regular,
  growth: ArrowTrending20Regular,
  coverage: PeopleTeam20Regular,
  quarter: ChartMultiple20Regular,
};

export function KpiCard({ label, value, sublabel, accent = "revenue", icon, size = "lg" }: KpiCardProps) {
  const AccentIcon = ACCENT_ICON[accent];
  const resolvedIcon = icon === null ? null : (icon ?? <AccentIcon />);

  return (
    <div
      className={`h-full rounded-2xl border-l-4 ${kpiAccentBorderClass[accent]} bg-surface p-6 flex flex-col gap-2 min-w-0 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.14)] hover:-translate-y-1`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-normal text-muted truncate">{label}</span>
        {resolvedIcon ? <span className={`shrink-0 ${kpiAccentIconClass[accent]}`}>{resolvedIcon}</span> : null}
      </div>
      <div className={`min-h-[56px] flex items-center ${VALUE_SIZE_CLASS[size]} font-semibold tabular-nums text-foreground truncate`}>
        {value}
      </div>
      {sublabel ? <div className="text-[13px] text-muted-strong truncate">{sublabel}</div> : null}
    </div>
  );
}
