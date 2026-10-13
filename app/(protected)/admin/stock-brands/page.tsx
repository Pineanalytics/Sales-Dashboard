import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { isEmptiesItem, mapSkuBrand, type BrandRule } from "@/lib/brandMapping";
import { addStockBrandRuleAction, deleteStockBrandRuleAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";

export default async function AdminStockBrandsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const { error, success } = await searchParams;

  const [stock, ruleRows] = await Promise.all([
    prisma.stockActual.findMany({ select: { principal: true, item: true, openingValue: true } }),
    prisma.stockBrandRule.findMany({ orderBy: [{ principalKey: "asc" }, { keyword: "asc" }] }),
  ]);
  const rules: BrandRule[] = ruleRows.map((r) => ({ principalKey: r.principalKey, keyword: r.keyword, brand: r.brand, mode: r.mode === "CONTAINS" ? "CONTAINS" : "PREFIX" }));

  // What each principal's brands look like today, and which come only from the first word of the name (no rule): those are the ones to check.
  const principals = new Map<string, { name: string; value: number; brands: Map<string, { items: number; value: number; auto: boolean; example: string }> }>();
  let empties = 0;
  let emptiesValue = 0;
  for (const row of stock) {
    if (isEmptiesItem(row.item)) {
      empties += 1;
      emptiesValue += row.openingValue;
      continue;
    }
    const key = normalizePrincipalKey(row.principal);
    const entry = principals.get(key) ?? { name: row.principal.split("-")[0].trim(), value: 0, brands: new Map() };
    const mapped = mapSkuBrand(key, row.item, rules);
    const brandEntry = entry.brands.get(mapped.brand) ?? { items: 0, value: 0, auto: true, example: row.item };
    brandEntry.items += 1;
    brandEntry.value += row.openingValue;
    if (mapped.source === "rule") brandEntry.auto = false;
    entry.brands.set(mapped.brand, brandEntry);
    entry.value += row.openingValue;
    principals.set(key, entry);
  }
  const ordered = Array.from(principals.entries()).sort((a, b) => b[1].value - a[1].value);
  const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Stock brands</h1>
        <p className="mt-1 text-sm text-white/70">How each SKU gets its brand on the Stock screens and for the stock cover targets.</p>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{error}</p> : null}
        {success ? <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{success}</p> : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            SAP has no usable brand (its field is the manufacturer, or &ldquo;-Select Manufacturer-&rdquo;), so a SKU&apos;s brand is worked out from its item name: first your rules below (longest keyword first), then the built-in rules for the known abbreviations,
            then the first word of the name. Brands marked <em>first word</em> have no rule: check them and add a rule where the first word is not the brand. Set the days of cover for each brand on{" "}
            <Link href="/admin/stock-cover" className="text-primary-blue hover:underline">
              Stock cover targets
            </Link>
            .
          </p>
          <form action={addStockBrandRuleAction} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Principal
              <select name="principal" className={inputClass} required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {ordered.map(([key, principal]) => (
                  <option key={key} value={key}>
                    {principal.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Item name
              <select name="mode" className={inputClass} defaultValue="PREFIX">
                <option value="PREFIX">starts with</option>
                <option value="CONTAINS">contains</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Keyword
              <input name="keyword" required minLength={2} maxLength={60} placeholder="e.g. blue band" className={`${inputClass} w-44`} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Brand
              <input name="brand" required minLength={2} maxLength={60} placeholder="e.g. Blue Band" className={`${inputClass} w-44`} />
            </label>
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
              Add rule
            </button>
          </form>
        </div>

        {ruleRows.length > 0 ? (
          <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <h2 className="text-lg font-semibold text-primary-blue">Your rules</h2>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {ruleRows.map((rule) => (
                  <tr key={rule.id} className="border-t border-border/60">
                    <td className="py-2 pr-3 text-muted">{rule.principalKey}</td>
                    <td className="py-2 pr-3">
                      {rule.mode === "CONTAINS" ? "contains" : "starts with"} <span className="font-medium">&ldquo;{rule.keyword}&rdquo;</span>
                    </td>
                    <td className="py-2 pr-3">→ {rule.brand}</td>
                    <td className="py-2 text-right">
                      <form action={deleteStockBrandRuleAction}>
                        <input type="hidden" name="id" value={rule.id} />
                        <button type="submit" className="text-[13px] font-medium text-accent-red hover:underline">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Brands today</h2>
          <p className="mt-1 text-[13px] text-muted">
            {empties > 0 ? `${empties} returnable empties SKU${empties === 1 ? "" : "s"} (${compact(emptiesValue)}) are left out: crates and bottles are packaging, not product to cover.` : "No returnable empties in stock."}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[13px] uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4 font-medium">Principal / brand</th>
                  <th className="py-2 pr-4 text-right font-medium">SKUs</th>
                  <th className="py-2 pr-4 text-right font-medium">Stock value</th>
                  <th className="py-2 font-medium">Named by</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map(([key, principal]) => (
                  <Fragment key={key}>
                    <tr key={key} className="border-t-2 border-border">
                      <td className="py-2 pr-4 font-medium text-foreground">{principal.name}</td>
                      <td className="py-2 pr-4 text-right text-muted">{Array.from(principal.brands.values()).reduce((s, b) => s + b.items, 0)}</td>
                      <td className="py-2 pr-4 text-right text-muted">{compact(principal.value)}</td>
                      <td />
                    </tr>
                    {Array.from(principal.brands.entries())
                      .sort((a, b) => b[1].value - a[1].value)
                      .map(([brand, info]) => (
                        <tr key={`${key}-${brand}`} className="border-t border-border/60">
                          <td className="py-1.5 pl-6 pr-4 text-foreground">{brand}</td>
                          <td className="py-1.5 pr-4 text-right">{info.items}</td>
                          <td className="py-1.5 pr-4 text-right">{compact(info.value)}</td>
                          <td className="py-1.5 text-[13px] text-muted">{info.auto ? `first word (e.g. ${info.example})` : "rule"}</td>
                        </tr>
                      ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
