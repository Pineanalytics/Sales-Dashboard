"use client";

import { useEffect, useState } from "react";
import { Sparkle20Regular } from "@fluentui/react-icons";
import { SectionCard } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { useDashboardStore } from "@/lib/store";
import type { AiInsightRecord, FindingSeverity } from "@/lib/aiInsights";
import type { PeriodSelection } from "@/lib/timeIntelligence";

const SEVERITY_TIER: Record<FindingSeverity, "good" | "warn" | "bad"> = {
  info: "good",
  warning: "warn",
  critical: "bad",
};

function buildQuery(period: PeriodSelection, principalKey: string | null): string {
  const params = new URLSearchParams();
  params.set("kind", period.kind);
  params.set("year", period.year);
  if (period.month) params.set("month", period.month);
  if (period.toYear) params.set("toYear", period.toYear);
  if (period.toMonth) params.set("toMonth", period.toMonth);
  if (principalKey) params.set("principal", principalKey);
  return params.toString();
}

/** Mirrors lib/aiInsights.ts's own describePeriod() for the small label shown
 *  next to the timestamp — duplicated rather than imported, since that file
 *  pulls in Prisma/Anthropic at module scope and can't be imported into a
 *  "use client" component beyond its type-only exports. */
function describePeriod(period: PeriodSelection): string {
  switch (period.kind) {
    case "MTD":
      return `MTD (${period.month} ${period.year})`;
    case "MONTH":
      return `${period.month} ${period.year}`;
    case "QTD":
      return `QTD ${period.year}`;
    case "YTD":
      return `YTD ${period.year}`;
    case "CUSTOM":
      return `${period.month} ${period.year} – ${period.toMonth} ${period.toYear}`;
    default:
      return `${period.kind} ${period.year}`;
  }
}

/** Displays the AI digest for whatever the top PeriodSelector/PrincipalSelector
 *  is currently set to (lib/aiInsights.ts computes the figures for that exact
 *  selection) — served from a short-lived cache when one already exists for
 *  it, generated on demand otherwise. Waits for the store's period to be
 *  populated (it starts empty before AnalyticsShell's SSR-dataset hydration
 *  effect runs) before fetching, and refetches whenever the selection
 *  changes. */
export function AiInsightsCard() {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [insight, setInsight] = useState<AiInsightRecord | null>(null);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const principalKey = useDashboardStore((s) => s.selectedPrincipalKey);

  useEffect(() => {
    if (!period.year) return; // store not hydrated yet — this effect re-runs once it is
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(`/api/ai-insights?${buildQuery(period, principalKey)}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load AI insights.");
        if (!cancelled) {
          setInsight(body.insight);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, principalKey]);

  if (status === "loading") {
    return (
      <SectionCard title="Insights">
        <div className="flex items-center justify-center py-6">
          <Spinner className="h-5 w-5" />
        </div>
      </SectionCard>
    );
  }

  if (status === "error" || !insight) {
    return (
      <SectionCard title="Insights" action={<Sparkle20Regular className="h-4 w-4 text-muted" />}>
        <p className="px-1 py-2 text-xs text-muted">{status === "error" ? "Couldn't generate a digest for this selection." : "No digest available."}</p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Insights"
      action={
        <span className="text-xs text-muted">
          {describePeriod(insight.period)}
          {insight.principalKey ? ` · ${insight.principalKey}` : ""} · {new Date(insight.generatedAt).toLocaleString()}
        </span>
      }
    >
      <p className="px-1 text-sm text-foreground leading-relaxed">{insight.summary}</p>
      {insight.findings.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2 px-1">
          {insight.findings.map((f, i) => (
            <div key={i} className="flex items-start gap-2">
              <Badge tier={SEVERITY_TIER[f.severity]}>{f.severity}</Badge>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">{f.title}</div>
                <div className="text-xs text-muted">{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}
