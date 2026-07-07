import type { Dataset } from "./types";
import type { Tier } from "./format";
import { daysCoverTier, marginTier } from "./format";
import {
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  summarizeCoverageForPeriod,
  type PeriodSelection,
} from "./timeIntelligence";
import { aggregateStockByPrincipal } from "./stock";
import { normalizePrincipalKey } from "./normalize";

export interface Insight {
  tier: Tier;
  title: string;
  text: string;
}

export function generatePortfolioInsights(dataset: Dataset, period: PeriodSelection): Insight[] {
  const insights: Insight[] = [];
  const sales = summarizeSalesForPeriod(dataset, period, null);

  if (sales.achievementPct !== null) {
    const tier: Tier = sales.achievementPct >= 100 ? "good" : sales.achievementPct >= 60 ? "warn" : "bad";
    insights.push({
      tier,
      title: tier === "good" ? "Portfolio on track vs target" : "Portfolio behind target",
      text: `Achieved ${sales.achievementPct.toFixed(1)}% of target (${sales.revenue.toLocaleString()} vs ${sales.target?.toLocaleString()}).`,
    });
  }

  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, period).values());
  const onTarget = byPrincipal.filter((p) => p.achievementPct !== null && p.achievementPct >= 100);
  if (onTarget.length > 0) {
    insights.push({
      tier: "good",
      title: `${onTarget.length} principal${onTarget.length > 1 ? "s" : ""} at 100%+ of target`,
      text: onTarget
        .slice(0, 5)
        .map((p) => p.principal)
        .join(", "),
    });
  }

  const stockRollups = aggregateStockByPrincipal(dataset);
  const stockRisk = stockRollups.filter((r) => r.outOfStockCount > 0).sort((a, b) => b.outOfStockCount - a.outOfStockCount);
  const totalOOS = stockRollups.reduce((s, r) => s + r.outOfStockCount, 0);
  if (stockRisk.length > 0) {
    insights.push({
      tier: "bad",
      title: `${totalOOS} SKUs out of stock across ${stockRisk.length} principal${stockRisk.length > 1 ? "s" : ""}`,
      text: `Highest risk: ${stockRisk
        .slice(0, 3)
        .map((r) => `${r.name} (${r.outOfStockCount})`)
        .join(", ")}.`,
    });
  }

  const coverage = summarizeCoverageForPeriod(dataset, period, null);
  insights.push({
    tier: coverage.productivityPct >= 80 ? "good" : coverage.productivityPct >= 50 ? "warn" : "bad",
    title: `Portfolio productivity ${coverage.productivityPct.toFixed(1)}%`,
    text: `${coverage.coverage.toLocaleString()} outlets covered, ${coverage.productiveCalls.toLocaleString()} productive.`,
  });

  return insights;
}

export function generatePrincipalInsights(dataset: Dataset, period: PeriodSelection, principalKey: string): Insight[] {
  const insights: Insight[] = [];
  const sales = summarizeSalesForPeriod(dataset, period, principalKey);
  const coverage = summarizeCoverageForPeriod(dataset, period, principalKey);
  const stockRollup = aggregateStockByPrincipal(dataset).find((r) => r.key === normalizePrincipalKey(principalKey));

  const achTier: Tier = sales.achievementPct === null ? "neutral" : sales.achievementPct >= 100 ? "good" : sales.achievementPct >= 60 ? "warn" : "bad";
  insights.push({
    tier: achTier,
    title: sales.achievementPct === null ? "No target set for this period" : `Achievement ${sales.achievementPct.toFixed(1)}%`,
    text:
      sales.achievementPct === null
        ? "No target is configured for this period."
        : sales.achievementPct >= 100
          ? "Ahead of target."
          : sales.achievementPct >= 60
            ? "Tracking behind target — monitor closely."
            : "Significantly behind target — needs intervention.",
  });

  const mTier = marginTier(sales.grossMarginPct);
  insights.push({
    tier: mTier,
    title: sales.grossMarginPct === null ? "No margin data" : `Gross margin ${sales.grossMarginPct.toFixed(1)}%`,
    text:
      mTier === "good"
        ? "Healthy margin profile."
        : mTier === "warn"
          ? "Moderate margin — watch pricing and cost pressure."
          : mTier === "bad"
            ? "Thin margin — review pricing/discounting."
            : "Margin data unavailable for this period.",
  });

  insights.push({
    tier: coverage.productivityPct >= 80 ? "good" : coverage.productivityPct >= 50 ? "warn" : "bad",
    title: `Productivity ${coverage.productivityPct.toFixed(1)}%`,
    text: `${coverage.coverage.toLocaleString()} outlets covered, ${coverage.productiveCalls.toLocaleString()} productive.`,
  });

  if (stockRollup) {
    if (stockRollup.outOfStockCount > 0) {
      insights.push({
        tier: "bad",
        title: `${stockRollup.outOfStockCount} SKU${stockRollup.outOfStockCount > 1 ? "s" : ""} out of stock`,
        text: "Reorder urgently to avoid lost sales.",
      });
    } else {
      const dTier = daysCoverTier(stockRollup.daysStock);
      insights.push({
        tier: dTier,
        title: `${stockRollup.daysStock.toFixed(1)} days stock cover`,
        text:
          dTier === "warn"
            ? "Cover is running long — consider reducing next order quantity."
            : dTier === "good"
              ? "Stock cover is within a healthy range."
              : "Stock levels are tight — monitor run-rate closely.",
      });
    }
  }

  return insights;
}
