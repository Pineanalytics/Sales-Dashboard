import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { upsertTargetAction, deleteTargetAction, addAssortmentSkuAction, toggleAssortmentSkuAction, deleteAssortmentSkuAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function AdminUnileverKpisPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; month?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, month: monthParam } = await searchParams;
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonthValue();
  const [year, mo] = month.split("-").map(Number);
  const monthDate = new Date(Date.UTC(year, mo - 1, 1));

  const [targets, assortmentSkus, knownPjps] = await Promise.all([
    prisma.unileverKpiTarget.findMany({ where: { month: monthDate }, orderBy: [{ distributor: "asc" }, { pjp: "asc" }] }),
    prisma.unileverAssortmentSku.findMany({ orderBy: { sku: "asc" } }),
    prisma.pjpSkuPerformance.findMany({ distinct: ["distributor", "pjp"], select: { distributor: true, pjp: true, route: true }, orderBy: { pjp: "asc" } }),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Unilever KPI setup</h1>
        <p className="mt-1 text-sm text-white/70">
          Feeds the Unilever Individual Sales Productivity card on Principal KPIs. Sales, LPPC and execution counts are computed live from the synced
          Centegy data — this page only holds the two inputs that data alone can&apos;t supply: each PJP&apos;s monthly sales target, and the core
          assortment SKU basket used for Perfect Assortment.
        </p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{error}</p> : null}
        {success ? <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{success}</p> : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-primary-blue">PJP sales targets — {month}</h2>
            <form method="get" className="flex items-center gap-2">
              <label className="sr-only" htmlFor="month-picker">Month</label>
              <input id="month-picker" type="month" name="month" defaultValue={month} className={inputClass} />
              <button type="submit" className="rounded-full bg-background-elevated px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Go</button>
            </form>
          </div>

          <form action={upsertTargetAction} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <input type="hidden" name="month" value={month} />
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Distributor</label>
              <select name="distributor" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select branch</option>
                {Object.entries(SALES_RETURNS_BRANCH_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>PJP (route code)</label>
              <select name="pjp" defaultValue="" className={inputClass}>
                <option value="">— choose existing —</option>
                {knownPjps.map((row) => (
                  <option key={`${row.distributor}-${row.pjp}`} value={row.pjp}>{row.pjp} ({row.route})</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Or a new PJP code</label>
              <input name="newPjp" placeholder="VAN_A_OB" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Sales Target (KES)</label>
              <input name="salesTarget" type="number" step="any" required className={inputClass} />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
                Save target
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Targets for {month} ({targets.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Branch</th>
                  <th className="px-6 py-3 text-left font-medium">PJP</th>
                  <th className="px-6 py-3 text-right font-medium">Sales Target (KES)</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td className="px-6 py-3 border-b border-border/60">{SALES_RETURNS_BRANCH_LABELS[t.distributor] ?? t.distributor}</td>
                    <td className="px-6 py-3 border-b border-border/60">{t.pjp}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">{t.salesTarget.toLocaleString("en-US")}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">
                      <form action={deleteTargetAction} className="inline">
                        <input type="hidden" name="targetId" value={t.id} />
                        <input type="hidden" name="month" value={month} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted">No targets set for {month} yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Core assortment basket</h2>
          <p className="mt-1 text-[13px] text-muted">
            Perfect Assortment stays &quot;pending&quot; on the KPI card until this list has at least one active SKU. An outlet counts as perfectly
            assorted for a month once it has bought every active SKU below at least once.
          </p>
          <form action={addAssortmentSkuAction} className="mt-4 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>SKU code</label>
              <input name="sku" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Description (optional)</label>
              <input name="skuDesc" className={inputClass} />
            </div>
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
              Add SKU
            </button>
          </form>

          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">SKU</th>
                  <th className="px-6 py-3 text-left font-medium">Description</th>
                  <th className="px-6 py-3 text-left font-medium">Status</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assortmentSkus.map((row) => (
                  <tr key={row.id}>
                    <td className="px-6 py-3 border-b border-border/60">{row.sku}</td>
                    <td className="px-6 py-3 border-b border-border/60">{row.skuDesc ?? "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60">
                      <span className={row.active ? "text-accent-green" : "text-muted"}>{row.active ? "Active" : "Inactive"}</span>
                    </td>
                    <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                      <form action={toggleAssortmentSkuAction} className="inline">
                        <input type="hidden" name="skuId" value={row.id} />
                        <input type="hidden" name="active" value={String(row.active)} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                          {row.active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                      <form action={deleteAssortmentSkuAction} className="inline">
                        <input type="hidden" name="skuId" value={row.id} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {assortmentSkus.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted">No SKUs in the basket yet — Perfect Assortment stays pending until at least one is added.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
