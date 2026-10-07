import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listGpMarginTargetRows } from "@/lib/gpMarginTargets";
import { GP_MARGIN_DEFAULT_KEY, GP_MARGIN_OVERALL_KEY } from "@/lib/financePresentation";
import { resetGpMarginTargetsAction, saveGpMarginTargetsAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "w-28 rounded-full border border-border bg-surface px-4 py-2 text-right text-sm text-foreground outline-none focus:border-secondary-blue";

export default async function AdminGpTargetsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const { error, success } = await searchParams;
  const { rows, defaultRow, overallRow } = await listGpMarginTargetRows();

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">GP margin targets</h1>
        <p className="mt-1 text-sm text-white/70">Target gross margin by principal brand, used by the Finance Presentation and the Financials Sales Performance tab.</p>
      </div>

      <div className="max-w-3xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{error}</p> : null}
        {success ? <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{success}</p> : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <form action={saveGpMarginTargetsAction} className="flex flex-col gap-4">
            <p className="text-[13px] text-muted">
              Enter each target as a percentage of revenue (15 means 15%). Locations of a brand share its target: Mars-Nairobi uses Mars, EABL-Nyeri and EABL-Nyahururu both use EABL. These replace the per-month
              &ldquo;GP margin target&rdquo; on the Targets page for the Finance views.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[13px] uppercase tracking-wide text-muted">
                    <th className="py-2 pr-4 font-medium">Brand</th>
                    <th className="py-2 pr-4 text-right font-medium">Target %</th>
                    <th className="py-2 text-right font-medium">Policy default</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b-2 border-border">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-foreground">Overall (company total)</span>
                      {overallRow.customised ? <span className="ml-2 rounded-full bg-accent-blue-soft px-2 py-0.5 text-[11px] font-semibold text-primary-blue">edited</span> : null}
                      <input type="hidden" name={`label:${GP_MARGIN_OVERALL_KEY}`} value="Overall (company total)" />
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <input name={`pct:${GP_MARGIN_OVERALL_KEY}`} type="number" min={0} max={100} step="0.1" defaultValue={overallRow.targetPct} className={inputClass} aria-label="Overall company target margin %" />
                    </td>
                    <td className="py-2 text-right text-muted">{overallRow.defaultPct}%</td>
                  </tr>
                  {rows.map((row) => (
                    <tr key={row.brandKey} className="border-t border-border/60">
                      <td className="py-2 pr-4">
                        <span className="font-medium text-foreground">{row.label}</span>
                        {row.customised ? <span className="ml-2 rounded-full bg-accent-blue-soft px-2 py-0.5 text-[11px] font-semibold text-primary-blue">edited</span> : null}
                        <input type="hidden" name={`label:${row.brandKey}`} value={row.label} />
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <input name={`pct:${row.brandKey}`} type="number" min={0} max={100} step="0.1" defaultValue={row.targetPct} className={inputClass} aria-label={`${row.label} target margin %`} />
                      </td>
                      <td className="py-2 text-right text-muted">{row.defaultPct}%</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border">
                    <td className="py-2 pr-4">
                      <span className="font-medium text-foreground">All other brands</span>
                      {defaultRow.customised ? <span className="ml-2 rounded-full bg-accent-blue-soft px-2 py-0.5 text-[11px] font-semibold text-primary-blue">edited</span> : null}
                      <input type="hidden" name={`label:${GP_MARGIN_DEFAULT_KEY}`} value="All other brands" />
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <input name={`pct:${GP_MARGIN_DEFAULT_KEY}`} type="number" min={0} max={100} step="0.1" defaultValue={defaultRow.targetPct} className={inputClass} aria-label="All other brands target margin %" />
                    </td>
                    <td className="py-2 text-right text-muted">{defaultRow.defaultPct}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
                Save targets
              </button>
            </div>
          </form>
          <form action={resetGpMarginTargetsAction} className="mt-3">
            <button type="submit" className="rounded-full px-5 py-2 text-sm font-medium text-muted-strong hover:bg-background-elevated">
              Reset everything to the policy defaults
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
