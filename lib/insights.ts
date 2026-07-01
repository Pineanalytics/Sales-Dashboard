import type { Dataset, Principal } from "./types";
import type { Tier } from "./format";
import { daysCoverTier, marginTier, trendTier } from "./format";

export interface Insight {
  tier: Tier;
  title: string;
  text: string;
}

export function generatePortfolioInsights(dataset: Dataset): Insight[] {
  const { totals, principals, covTotal, stockTotal } = dataset;
  const insights: Insight[] = [];

  insights.push({
    tier: totals.h1Variance >= 0 ? "good" : "bad",
    title: totals.h1Variance >= 0 ? "H1 on track vs mission" : "H1 shortfall vs mission",
    text:
      totals.h1Variance >= 0
        ? `Portfolio H1 sales are ahead of mission by ${totals.h1Variance.toLocaleString()}.`
        : `Portfolio H1 sales are behind mission by ${Math.abs(totals.h1Variance).toLocaleString()} (${totals.h1Achieved.toFixed(1)}% achieved).`,
  });

  const onTarget = principals.filter((p) => p.achMTD !== null && p.achMTD >= 100);
  if (onTarget.length > 0) {
    insights.push({
      tier: "good",
      title: `${onTarget.length} principal${onTarget.length > 1 ? "s" : ""} at 100%+ MTD`,
      text: onTarget
        .slice(0, 5)
        .map((p) => p.name)
        .join(", "),
    });
  }

  const stockRisk = principals.filter((p) => p.stockOutOfStockCount > 0).sort((a, b) => b.stockOutOfStockCount - a.stockOutOfStockCount);
  if (stockRisk.length > 0) {
    insights.push({
      tier: "bad",
      title: `${stockTotal.outOfStockCount} SKUs out of stock across ${stockRisk.length} principal${stockRisk.length > 1 ? "s" : ""}`,
      text: `Highest risk: ${stockRisk
        .slice(0, 3)
        .map((p) => `${p.name} (${p.stockOutOfStockCount})`)
        .join(", ")}.`,
    });
  }

  insights.push({
    tier: covTotal.currentProductivityPct >= 80 ? "good" : covTotal.currentProductivityPct >= 50 ? "warn" : "bad",
    title: `Portfolio productivity ${covTotal.currentProductivityPct.toFixed(1)}%`,
    text: `${covTotal.currentCoverage.toLocaleString()} outlets covered, ${covTotal.currentProductiveCalls.toLocaleString()} productive in ${covTotal.currentMonth}.`,
  });

  return insights;
}

export function generatePrincipalInsights(principal: Principal): Insight[] {
  const insights: Insight[] = [];

  const achTier: Tier = principal.achMTD === null ? "neutral" : principal.achMTD >= 100 ? "good" : principal.achMTD >= 60 ? "warn" : "bad";
  insights.push({
    tier: achTier,
    title: principal.achMTD === null ? "No MTD target set" : `MTD achievement ${principal.achMTD.toFixed(1)}%`,
    text:
      principal.achMTD === null
        ? "This principal has no MTD target configured for the period."
        : principal.achMTD >= 100
          ? "Ahead of MTD target."
          : principal.achMTD >= 60
            ? "Tracking behind MTD target — monitor closely."
            : "Significantly behind MTD target — needs intervention.",
  });

  const momTier = trendTier(principal.mom);
  insights.push({
    tier: momTier,
    title: principal.mom === null ? "No MOM comparison" : `MOM ${principal.mom > 0 ? "+" : ""}${principal.mom.toFixed(1)}%`,
    text:
      principal.mom === null
        ? "No prior month data available for comparison."
        : principal.mom >= 0
          ? "Revenue is trending up month-on-month."
          : "Revenue is trending down month-on-month.",
  });

  const mTier = marginTier(principal.grossMarginPct);
  insights.push({
    tier: mTier,
    title: principal.grossMarginPct === null ? "No margin data" : `Gross margin ${principal.grossMarginPct.toFixed(1)}%`,
    text:
      mTier === "good"
        ? "Healthy margin profile."
        : mTier === "warn"
          ? "Moderate margin — watch pricing and cost pressure."
          : mTier === "bad"
            ? "Thin margin — review pricing/discounting."
            : "Margin data unavailable for this principal.",
  });

  if (principal.stockOutOfStockCount > 0) {
    insights.push({
      tier: "bad",
      title: `${principal.stockOutOfStockCount} SKU${principal.stockOutOfStockCount > 1 ? "s" : ""} out of stock`,
      text: "Reorder urgently to avoid lost sales.",
    });
  } else {
    const dTier = daysCoverTier(principal.daysStock);
    insights.push({
      tier: dTier,
      title: `${principal.daysStock.toFixed(1)} days stock cover`,
      text:
        dTier === "warn"
          ? "Cover is running long — consider reducing next order quantity."
          : dTier === "good"
            ? "Stock cover is within a healthy range."
            : "Stock levels are tight — monitor run-rate closely.",
    });
  }

  return insights;
}
