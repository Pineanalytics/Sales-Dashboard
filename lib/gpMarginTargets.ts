import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { DEFAULT_GP_MARGIN_TARGETS, brandLabel, mergeGpMarginTargets, type GpMarginTargets } from "@/lib/financePresentation";
import type { PrincipalGpTarget } from "@/lib/financeGpTarget";

/** The gross-margin targets in force: what an admin has saved, over the policy defaults. */
export async function getGpMarginTargets(): Promise<GpMarginTargets> {
  const saved = await prisma.gpMarginTarget.findMany({ select: { brandKey: true, targetPct: true } });
  return mergeGpMarginTargets(saved);
}

export interface GpMarginTargetRow {
  brandKey: string;
  label: string;
  /** The target in force, in percent. */
  targetPct: number;
  /** The policy default this brand falls back to when an admin has not saved one. */
  defaultPct: number;
  /** True when an admin has saved a value that differs from the default. */
  customised: boolean;
}

/** One editable row per brand: the five main brands plus every other brand that has a principal. */
export async function listGpMarginTargetRows(): Promise<{ rows: GpMarginTargetRow[]; defaultRow: { targetPct: number; defaultPct: number; customised: boolean } }> {
  const [targets, principals, saved] = await Promise.all([
    getGpMarginTargets(),
    prisma.principal.findMany({ where: { status: "Active" }, select: { principal: true } }),
    prisma.gpMarginTarget.findMany({ select: { brandKey: true, label: true, targetPct: true } }),
  ]);
  const savedByKey = new Map(saved.map((row) => [row.brandKey, row]));
  const brands = new Map<string, string>(Object.keys(DEFAULT_GP_MARGIN_TARGETS.byBrand).map((key) => [key, brandLabel(key)]));
  for (const { principal } of principals) {
    const key = normalizePrincipalKey(principal);
    if (key && !brands.has(key)) brands.set(key, brandLabel(principal));
  }
  for (const row of saved) if (row.brandKey !== "__default__" && !brands.has(row.brandKey)) brands.set(row.brandKey, row.label);

  const main = Object.keys(DEFAULT_GP_MARGIN_TARGETS.byBrand);
  const order = (key: string) => (main.includes(key) ? main.indexOf(key) : main.length);
  const rows = Array.from(brands.entries())
    .map(([brandKey, label]) => {
      const defaultPct = DEFAULT_GP_MARGIN_TARGETS.byBrand[brandKey] ?? DEFAULT_GP_MARGIN_TARGETS.defaultPct;
      const targetPct = targets.byBrand[brandKey] ?? targets.defaultPct;
      return { brandKey, label, targetPct, defaultPct, customised: savedByKey.has(brandKey) && savedByKey.get(brandKey)?.targetPct !== defaultPct };
    })
    .sort((a, b) => order(a.brandKey) - order(b.brandKey) || a.label.localeCompare(b.label));
  return {
    rows,
    defaultRow: { targetPct: targets.defaultPct, defaultPct: DEFAULT_GP_MARGIN_TARGETS.defaultPct, customised: savedByKey.has("__default__") && savedByKey.get("__default__")?.targetPct !== DEFAULT_GP_MARGIN_TARGETS.defaultPct },
  };
}

/** The Financials tab weights per-principal margin targets by revenue target; this swaps the margin each
 *  carries for the one in force here, so both Finance views agree. */
export function withGpMarginTargets(gpTargets: PrincipalGpTarget[], targets: GpMarginTargets): PrincipalGpTarget[] {
  return gpTargets.map((g) => {
    const key = normalizePrincipalKey(g.principal);
    const pct = targets.byBrand[key] ?? targets.defaultPct;
    return { ...g, grossMarginTargetPct: pct / 100 };
  });
}
