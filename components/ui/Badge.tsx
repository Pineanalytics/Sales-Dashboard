import type { Tier } from "@/lib/format";
import { tierBadgeClass } from "@/lib/format";

export function Badge({ children, tier = "neutral" }: { children: React.ReactNode; tier?: Tier }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tierBadgeClass[tier]}`}
    >
      {children}
    </span>
  );
}

export function AchievementBadge({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) {
    return <Badge tier="neutral">N/T</Badge>;
  }
  const tier = pct >= 100 ? "good" : pct >= 60 ? "warn" : "bad";
  return <Badge tier={tier}>{pct.toFixed(1)}%</Badge>;
}
