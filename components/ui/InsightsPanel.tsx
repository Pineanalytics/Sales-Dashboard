import type { Insight } from "@/lib/insights";

const TIER_BORDER: Record<Insight["tier"], string> = {
  good: "border-l-accent-green",
  warn: "border-l-accent-amber",
  bad: "border-l-accent-red",
  neutral: "border-l-accent-blue",
};

export function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {insights.map((insight, i) => (
        <div
          key={i}
          className={`rounded-2xl border-l-4 ${TIER_BORDER[insight.tier]} bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-all duration-300 hover:shadow-[0_8px_20px_rgba(0,0,0,0.14)] hover:-translate-y-0.5`}
        >
          <p className="text-sm font-semibold text-foreground">{insight.title}</p>
          <p className="mt-1 text-xs text-muted-strong">{insight.text}</p>
        </div>
      ))}
    </div>
  );
}
