import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { isEmptiesItem, mapSkuBrand, type BrandRule } from "@/lib/brandMapping";
import { AdminBadge, AdminCard, AdminNotices, AdminPage, searchText } from "@/components/admin/AdminPage";
import { AdminTableSearch } from "@/components/admin/AdminTableSearch";
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
  const firstWordBrands = ordered.reduce((n, [, principal]) => n + Array.from(principal.brands.values()).filter((b) => b.auto).length, 0);
  const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));

  return (
    <AdminPage
      title="Stock brands"
      description="How each SKU gets its brand on the Stock screens and for the stock cover targets."
      stats={[
        { label: "principals", value: ordered.length },
        { label: "your rules", value: ruleRows.length },
        ...(firstWordBrands > 0 ? [{ label: "brands named by first word", value: firstWordBrands, tone: "attention" as const }] : []),
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
        <AdminCard title="Add a brand rule">
          <div className="flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            SAP has no usable brand (its field is the manufacturer, or &ldquo;-Select Manufacturer-&rdquo;), so a SKU&apos;s brand is worked out from its item name: first your rules below (longest keyword first), then the built-in rules for the known abbreviations,
            then the first word of the name. Brands marked <em>first word</em> have no rule: check them and add a rule where the first word is not the brand. Set the days of cover for each brand on{" "}
            <Link href="/admin/stock-cover" className="text-primary-blue hover:underline">
              Stock cover targets
            </Link>
            .
          </p>
          <form action={addStockBrandRuleAction} className="grid grid-cols-2 items-end gap-2">
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Principal
              <select name="principal" className={`${inputClass} w-full`} required defaultValue="">
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
              <select name="mode" className={`${inputClass} w-full`} defaultValue="PREFIX">
                <option value="PREFIX">starts with</option>
                <option value="CONTAINS">contains</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Keyword
              <input name="keyword" required minLength={2} maxLength={60} placeholder="e.g. blue band" className={`${inputClass} w-full`} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-muted">
              Brand
              <input name="brand" required minLength={2} maxLength={60} placeholder="e.g. Blue Band" className={`${inputClass} w-full`} />
            </label>
            <button type="submit" className="col-span-2 justify-self-start rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
              Add rule
            </button>
          </form>
          </div>
        </AdminCard>

        {ruleRows.length > 0 ? (
          <AdminCard title={<>Your rules <AdminBadge>{ruleRows.length}</AdminBadge></>}>
            <div className="max-h-[50vh] overflow-y-auto">
            <table className="w-full text-sm">
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
          </AdminCard>
        ) : null}
        </div>

        <AdminCard
          title="Brands today"
          actions={<AdminTableSearch target="stock-brands" placeholder="Search principal or brand" />}
          description={<>
            {empties > 0 ? `${empties} returnable empties SKU${empties === 1 ? "" : "s"} (${compact(emptiesValue)}) are left out: crates and bottles are packaging, not product to cover.` : "No returnable empties in stock."}
          </>}
        >
          <div className="overflow-x-auto" data-filter-root="stock-brands">
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
                    <tr key={key} className="border-t-2 border-border" data-search={searchText(principal.name, ...Array.from(principal.brands.keys()))}>
                      <td className="py-2 pr-4 font-medium text-foreground">{principal.name}</td>
                      <td className="py-2 pr-4 text-right text-muted">{Array.from(principal.brands.values()).reduce((s, b) => s + b.items, 0)}</td>
                      <td className="py-2 pr-4 text-right text-muted">{compact(principal.value)}</td>
                      <td />
                    </tr>
                    {Array.from(principal.brands.entries())
                      .sort((a, b) => b[1].value - a[1].value)
                      .map(([brand, info]) => (
                        <tr key={`${key}-${brand}`} className="border-t border-border/60" data-search={searchText(principal.name, brand, info.auto ? "first word" : "rule")}>
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
        </AdminCard>
      </div>
    </AdminPage>
  );
}
