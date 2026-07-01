import type { Dataset, Principal } from "./types";

export function findPrincipal(dataset: Dataset, name: string | null): Principal | null {
  if (!name) return null;
  return dataset.principals.find((p) => p.name === name) ?? null;
}

export function principalsByMtdRevDesc(dataset: Dataset): Principal[] {
  return [...dataset.principals].sort((a, b) => b.mtdRev - a.mtdRev);
}

export interface TargetSummary {
  onTarget: number; // >= 100%
  atRisk: number; // 50-99%
  below: number; // < 50%
  noTarget: number;
}

export function summarizeTargets(principals: Principal[]): TargetSummary {
  const summary: TargetSummary = { onTarget: 0, atRisk: 0, below: 0, noTarget: 0 };
  for (const p of principals) {
    if (p.achMTD === null) summary.noTarget += 1;
    else if (p.achMTD >= 100) summary.onTarget += 1;
    else if (p.achMTD >= 50) summary.atRisk += 1;
    else summary.below += 1;
  }
  return summary;
}
