import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { listGpMarginTargetRows } from "@/lib/gpMarginTargets";
import { GP_MARGIN_DEFAULT_KEY, GP_MARGIN_OVERALL_KEY } from "@/lib/financePresentation";
import { AdminCard, AdminNotices, AdminPage } from "@/components/admin/AdminPage";
import { resetGpMarginTargetsAction, saveGpMarginTargetsAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "w-28 rounded-full border border-border bg-surface px-4 py-2 text-right text-sm text-foreground outline-none focus:border-secondary-blue";

export default async function AdminGpTargetsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");

  const { error, success } = await searchParams;
  const { rows, defaultRow, overallRow } = await listGpMarginTargetRows();

  return (
    <AdminPage
      title="GP margin targets"
      description="Target gross margin by principal brand, used by the Finance Presentation and the Financials Sales Performance tab."
      stats={[
        { label: "brands", value: rows.length },
        { label: "edited", value: rows.filter((row) => row.customised).length + (overallRow.customised ? 1 : 0) + (defaultRow.customised ? 1 : 0) },
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <AdminCard title="Targets by brand" description="Edit any box and save; the policy default is shown for comparison.">
          <form action={saveGpMarginTargetsAction} className="flex flex-col gap-4">
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
        </AdminCard>

        <AdminCard title="How targets apply" className="xl:sticky xl:top-28">
          <div className="flex flex-col gap-3 text-[13px] text-muted">
            <p>Enter each target as a percentage of revenue (15 means 15%).</p>
            <p>Locations of a brand share its target: Mars-Nairobi uses Mars, EABL-Nyeri and EABL-Nyahururu both use EABL.</p>
            <p>
              These replace the per-month &ldquo;GP margin target&rdquo; on the{" "}
              <Link href="/admin/targets" className="text-primary-blue hover:underline">
                Targets
              </Link>{" "}
              page for the Finance views.
            </p>
          </div>
          <form action={resetGpMarginTargetsAction} className="mt-4 border-t border-border/60 pt-3">
            <button type="submit" className="rounded-full px-4 py-2 text-sm font-medium text-muted-strong hover:bg-background-elevated">
              Reset everything to the policy defaults
            </button>
          </form>
        </AdminCard>
      </div>
    </AdminPage>
  );
}
