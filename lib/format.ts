// Shared display formatting helpers used across every view.

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatPercent(value: number | null | undefined, opts?: { signed?: boolean }): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/T";
  const sign = opts?.signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

/** YOY/MOM style % with outlier guard: swings from a near-zero base aren't meaningful. */
export function formatTrendPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) > 500) return "outlier";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export type Tier = "good" | "warn" | "bad" | "neutral";

export function achievementTier(achMTD: number | null | undefined): Tier {
  if (achMTD === null || achMTD === undefined) return "neutral";
  if (achMTD >= 100) return "good";
  if (achMTD >= 60) return "warn";
  return "bad";
}

export function marginTier(marginPct: number | null | undefined): Tier {
  if (marginPct === null || marginPct === undefined) return "neutral";
  if (marginPct >= 15) return "good";
  if (marginPct >= 8) return "warn";
  return "bad";
}

export function productivityTier(pct: number | null | undefined): Tier {
  if (pct === null || pct === undefined) return "neutral";
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "bad";
}

export function daysCoverTier(days: number | null | undefined): Tier {
  if (days === null || days === undefined) return "neutral";
  if (days < 7) return "bad";
  if (days <= 21) return "good";
  return "warn";
}

export function trendTier(value: number | null | undefined): Tier {
  if (value === null || value === undefined) return "neutral";
  if (value > 0) return "good";
  if (value < 0) return "bad";
  return "neutral";
}

export const tierTextClass: Record<Tier, string> = {
  good: "text-accent-green",
  warn: "text-accent-amber",
  bad: "text-accent-red",
  neutral: "text-muted",
};

export const tierBadgeClass: Record<Tier, string> = {
  good: "bg-accent-green-soft text-accent-green border-accent-green/30",
  warn: "bg-accent-amber-soft text-accent-amber border-accent-amber/30",
  bad: "bg-accent-red-soft text-accent-red border-accent-red/30",
  neutral: "bg-accent-grey-soft text-muted-strong border-accent-grey/30",
};

export const tierBarColor: Record<Tier, string> = {
  good: "var(--accent-green)",
  warn: "var(--accent-amber)",
  bad: "var(--accent-red)",
  neutral: "var(--accent-grey)",
};

/** Fixed KPI-card category taxonomy (left border accent) — a classification, not a value sentiment. */
export type KpiAccent = "revenue" | "coverage" | "growth" | "mission" | "quarter";

export const kpiAccentBorderClass: Record<KpiAccent, string> = {
  revenue: "border-l-accent-blue",
  coverage: "border-l-accent-green",
  growth: "border-l-accent-red",
  mission: "border-l-accent-amber",
  quarter: "border-l-accent-purple",
};

export const kpiAccentIconClass: Record<KpiAccent, string> = {
  revenue: "text-accent-blue",
  coverage: "text-accent-green",
  growth: "text-accent-red",
  mission: "text-accent-amber",
  quarter: "text-accent-purple",
};

/** Strips the emoji prefix from a stock action string, keeping the label + a color tier. */
export function stockActionTier(action: string | null | undefined): { label: string; tier: Tier } {
  if (!action) return { label: "Unknown", tier: "neutral" };
  const label = action.replace(/^[^\w]+/u, "").trim();
  if (action.includes("🔴")) return { label, tier: "bad" };
  if (action.includes("🟡")) return { label, tier: "warn" };
  if (action.includes("🟢")) return { label, tier: "good" };
  return { label, tier: "neutral" };
}
