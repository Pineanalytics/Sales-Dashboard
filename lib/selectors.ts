import type { Dataset } from "./types";
import { summarizeSalesByPrincipal, type PeriodSelection, type PeriodSalesSummary } from "./timeIntelligence";

export interface PrincipalSummary extends PeriodSalesSummary {
  principal: string;
  principalKey: string;
}

export function principalsByRevenueDesc(dataset: Dataset, period: PeriodSelection): PrincipalSummary[] {
  return Array.from(summarizeSalesByPrincipal(dataset, period).values()).sort((a, b) => b.revenue - a.revenue);
}

export interface TargetSummary {
  onTarget: number; // achievementPct >= 100
  atRisk: number; // 50-99%
  below: number; // < 50%
  noTarget: number;
}

export function summarizeTargets(principals: PrincipalSummary[]): TargetSummary {
  const summary: TargetSummary = { onTarget: 0, atRisk: 0, below: 0, noTarget: 0 };
  for (const p of principals) {
    if (p.achievementPct === null) summary.noTarget += 1;
    else if (p.achievementPct >= 100) summary.onTarget += 1;
    else if (p.achievementPct >= 50) summary.atRisk += 1;
    else summary.below += 1;
  }
  return summary;
}
