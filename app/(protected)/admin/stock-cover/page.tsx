import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { normalizePrincipalKey } from "@/lib/normalize";
import { DEFAULT_OVERSTOCK_DAYS, DEFAULT_REORDER_DAYS, DEFAULT_TARGET_DAYS, resolveCoverThresholds, type CoverTargetRow } from "@/lib/standardStock";
import { saveStockCoverTargetsAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "w-24 rounded-full border border-border bg-surface px-3 py-1.5 text-right text-sm text-foreground outline-none focus:border-secondary-blue";

const FIELD_LABELS = [
  { field: "targetDays", label: "Target days" },
  { field: "reorderDays", label: "Reorder days" },
  { field: "overstockDays", label: "Overstock days" },
] as const;

export default async function AdminStockCoverPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const { error, success } = await searchParams;

  const [stock, targetRows] = await Promise.all([
    prisma.stockActual.groupBy({ by: ["principal", "brand"], _count: { _all: true }, _sum: { openingValue: true } }),
    prisma.stockCoverTarget.findMany(),
  ]);
  const rows: CoverTargetRow[] = targetRows.map((r) => ({
    scope: r.scope === "BRAND" ? "BRAND" : "PRINCIPAL",
    principalKey: r.principalKey,
    brand: r.brand,
    targetDays: r.targetDays,
    reorderDays: r.reorderDays,
    overstockDays: r.overstockDays,
  }));

  // Stock is grouped by brand key (the part of the principal name before its location), like the Stock screens do.
  const principals = new Map<string, { name: string; value: number; brands: Map<string, { items: number; value: number }> }>();
  for (const row of stock) {
    const key = normalizePrincipalKey(row.principal);
    const entry = principals.get(key) ?? { name: row.principal.split("-")[0].trim(), value: 0, brands: new Map() };
    const brand = row.brand?.trim() || "Unspecified";
    const brandEntry = entry.brands.get(brand) ?? { items: 0, value: 0 };
    brandEntry.items += row._count._all;
    brandEntry.value += row._sum.openingValue ?? 0;
    entry.brands.set(brand, brandEntry);
    entry.value += row._sum.openingValue ?? 0;
    principals.set(key, entry);
  }
  const ordered = Array.from(principals.entries()).sort((a, b) => b[1].value - a[1].value);

  const cell = (scope: "PRINCIPAL" | "BRAND", key: string, brand: string, name: string) => {
    const own = rows.find((r) => r.scope === scope && r.principalKey === key && r.brand === brand);
    const effective = resolveCoverThresholds(rows, key, scope === "BRAND" ? brand : undefined);
    const encodedKey = encodeURIComponent(key);
    const encodedBrand = encodeURIComponent(brand);
    return (
      <>
        <input type="hidden" name={`label:${scope}:${encodedKey}:${encodedBrand}`} value={name} />
        {FIELD_LABELS.map(({ field, label }) => (
          <td key={field} className="py-1.5 pr-3 text-right">
            <input
              name={`cell:${scope}:${encodedKey}:${encodedBrand}:${field}`}
              type="number"
              min={2}
              max={365}
              step={1}
              defaultValue={own?.[field] ?? ""}
              placeholder={String(effective[field])}
              className={inputClass}
              aria-label={`${name} ${label}`}
            />
          </td>
        ))}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Stock cover targets</h1>
        <p className="mt-1 text-sm text-white/70">Days of cover to aim for, per principal and per brand, used by the Stock screens and the standard stock figures.</p>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{error}</p> : null}
        {success ? <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{success}</p> : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <form action={saveStockCoverTargetsAction} className="flex flex-col gap-4">
            <div className="text-[13px] text-muted flex flex-col gap-1.5">
              <p>
                <strong className="text-foreground">Target days</strong>: the cover to hold. Standard stock = the standard run rate × target days.{" "}
                <strong className="text-foreground">Reorder days</strong>: a SKU with less cover than this is Running Out (default {DEFAULT_REORDER_DAYS}).{" "}
                <strong className="text-foreground">Overstock days</strong>: more cover than this is overstocked (default {DEFAULT_OVERSTOCK_DAYS}). Out of Stock stays the flat rule: no stock, or under 2 days of cover.
              </p>
              <p>
                Leave a box empty to inherit: a brand takes its principal&apos;s value, a principal takes the default ({DEFAULT_TARGET_DAYS} / {DEFAULT_REORDER_DAYS} / {DEFAULT_OVERSTOCK_DAYS}); the grey number in each box is the value in force. Reorder days can not exceed target days, nor
                target days overstock days. The standard run rate is the median of each SKU&apos;s last-4-weeks, last-13-weeks and year-to-date run rates.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-wide text-muted">
                    <th className="py-2 pr-4 font-medium">Principal / brand</th>
                    {FIELD_LABELS.map(({ field, label }) => (
                      <th key={field} className="py-2 pr-3 text-right font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ordered.map(([key, principal]) => (
                    <PrincipalRows key={key} principalKey={key} principal={principal} cell={cell} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
                Save cover targets
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function PrincipalRows({
  principalKey,
  principal,
  cell,
}: {
  principalKey: string;
  principal: { name: string; value: number; brands: Map<string, { items: number; value: number }> };
  cell: (scope: "PRINCIPAL" | "BRAND", key: string, brand: string, name: string) => React.ReactNode;
}) {
  const brands = Array.from(principal.brands.entries()).sort((a, b) => b[1].value - a[1].value);
  return (
    <>
      <tr className="border-t-2 border-border">
        <td className="py-2 pr-4 font-medium text-foreground">{principal.name}</td>
        {cell("PRINCIPAL", principalKey, "", principal.name)}
      </tr>
      {brands.length > 1 || (brands.length === 1 && brands[0][0] !== "Unspecified")
        ? brands.map(([brand, info]) => (
            <tr key={brand} className="border-t border-border/60">
              <td className="py-1.5 pl-6 pr-4 text-foreground">
                {brand} <span className="text-muted">· {info.items} SKU{info.items === 1 ? "" : "s"}</span>
              </td>
              {cell("BRAND", principalKey, brand, `${principal.name} · ${brand}`)}
            </tr>
          ))
        : null}
    </>
  );
}
