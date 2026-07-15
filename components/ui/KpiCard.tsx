import type { ReactNode } from "react";
import {
  Money20Regular,
  Target20Regular,
  ArrowTrending20Regular,
  PeopleTeam20Regular,
  ChartMultiple20Regular,
  ArrowUp16Filled,
  ArrowDown16Filled,
} from "@fluentui/react-icons";
import type { KpiAccent, Tier } from "@/lib/format";
import { kpiAccentBorderClass, kpiAccentIconClass, tierBadgeClass, trendTier } from "@/lib/format";
import { Sparkline } from "@/components/ui/Sparkline";

interface KpiDelta {
  /** Signed percent (or plain number) — sign alone drives the up/down arrow unless `tier` is set explicitly. */
  value: number;
  /** Overrides the sign-based tier (e.g. a "-3% cost" drop is `good`, not `bad`). */
  tier?: Tier;
  /** e.g. "vs last month" — rendered muted, after the pill. */
  caption?: string;
  /** How to format `value`; defaults to "+3.2%" style. */
  format?: (value: number) => string;
}

interface KpiCardProps {
  label: string;
  value: ReactNode;
  sublabel?: ReactNode;
  accent?: KpiAccent;
  /** Overrides the accent's default icon. Pass `null` to hide the icon entirely. */
  icon?: ReactNode | null;
  /** "lg" (default) is the 42px numeric KPI style; "md" suits longer text values (names, status labels, gauges). */
  size?: "lg" | "md";
  /** Small up/down trend pill, e.g. { value: 5.2, caption: "vs last month" }. */
  delta?: KpiDelta;
  /** Historical values for a minimal trend line under the KPI value — omit for none. */
  sparkline?: number[];
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

const DEFAULT_DELTA_FORMAT = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

export function KpiCard({ label, value, sublabel, accent = "revenue", icon, size = "lg", delta, sparkline }: KpiCardProps) {
  const AccentIcon = ACCENT_ICON[accent];
  const resolvedIcon = icon === null ? null : (icon ?? <AccentIcon />);
  const deltaTier = delta ? (delta.tier ?? trendTier(delta.value)) : null;
  const DeltaArrow = delta && delta.value < 0 ? ArrowDown16Filled : ArrowUp16Filled;

  return (
    <div
      className={`h-full rounded-2xl border-t-4 ${kpiAccentBorderClass[accent]} bg-surface p-6 flex flex-col gap-2 min-w-0 shadow-[0_1px_3px_rgba(10,31,82,0.06)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(10,31,82,0.12)] hover:-translate-y-1`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-normal text-muted truncate">{label}</span>
        {resolvedIcon ? (
          <span className={`shrink-0 rounded-xl bg-secondary-blue/10 p-2 flex items-center justify-center ${kpiAccentIconClass[accent]}`}>
            {resolvedIcon}
          </span>
        ) : null}
      </div>
      <div className={`min-h-[56px] flex items-center ${VALUE_SIZE_CLASS[size]} font-semibold tabular-nums text-brand-navy truncate`}>
        {value}
      </div>
      {delta || sublabel ? (
        <div className="flex items-center gap-2 min-w-0">
          {delta ? (
            <span className={`inline-flex items-center gap-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-semibold ${tierBadgeClass[deltaTier!]}`}>
              <DeltaArrow />
              {(delta.format ?? DEFAULT_DELTA_FORMAT)(delta.value)}
            </span>
          ) : null}
          {sublabel ? <span className="text-[13px] text-muted-strong truncate">{sublabel}</span> : null}
        </div>
      ) : null}
      {sparkline ? <Sparkline data={sparkline} /> : null}
    </div>
  );
}
