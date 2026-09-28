import Link from "next/link";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { formatCompact, formatPercent } from "@/lib/format";
import type { WeeklyMonthlyTargetSummary } from "@/lib/commercialPerformance";
import type { MonthlyVarianceStatus } from "@/lib/weeklyTargets";

// Same labels/colors as /targets-overview's own status legend — one
// convention for "does this principal's weekly rollup reconcile to its
// Monthly Target" everywhere it's shown.
const STATUS_META: Record<MonthlyVarianceStatus, { label: string; className: string }> = {
  "no-target": { label: "No Monthly Target set", className: "text-muted" },
  match: { label: "Matches Monthly Target", className: "text-accent-green" },
  over: { label: "Exceeds Monthly Target", className: "text-accent-red" },
  under: { label: "Understated vs. Monthly Target", className: "text-accent-red" },
  "in-progress": { label: "In progress", className: "text-accent-amber" },
};

const STATUS_ORDER: MonthlyVarianceStatus[] = ["match", "over", "under", "in-progress", "no-target"];
const NOTABLE_LIMIT = 5;

/** Server-computed (lib/commercialPerformance.ts) — a company-wide read of
 *  the exact same Weekly-rollup-vs-Monthly-Target reconciliation
 *  /weekly-targets and /targets-overview already show per-Team-Leader, just
 *  summarized here instead of re-editable. Links out to /targets-overview
 *  for the real edit surface rather than duplicating one inline. */
export function WeeklyMonthlyTargetPanel({ summary }: { summary: WeeklyMonthlyTargetSummary }) {
  const notable = summary.principals.filter((p) => p.status === "under" || p.status === "over").slice(0, NOTABLE_LIMIT);

  return (
    <div id="weekly-monthly-target" className="@container h-full">
      <SectionCard
        title="Weekly & Monthly Target"
        accent="blue"
        action={
          <Link href="/targets-overview" className="text-xs font-medium text-primary-blue hover:underline">
            Open Targets Overview →
          </Link>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3">
            <KpiCard accent="mission" label="Monthly Target" value={formatCompact(summary.totalMonthlyTarget)} sublabel={`${summary.month} ${summary.year}`} />
            <KpiCard accent="revenue" label="Weekly Rollup" value={formatCompact(summary.totalWeeklySum)} sublabel="Sum of entered weekly targets" />
            <KpiCard
              accent="quarter"
              label="Reconciliation"
              value={summary.achievementPct === null ? "—" : formatPercent(summary.achievementPct)}
              sublabel="Weekly rollup ÷ Monthly Target"
            />
          </div>

          <div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Principals by status</h4>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
              {STATUS_ORDER.filter((status) => summary.byStatus[status] > 0).map((status) => (
                <span key={status} className={STATUS_META[status].className}>
                  <span className="font-bold tabular-nums">{summary.byStatus[status]}</span> {STATUS_META[status].label}
                </span>
              ))}
              {summary.principals.length === 0 ? <span className="text-muted">No Weekly or Monthly Target data yet for this selection.</span> : null}
            </div>
          </div>

          {notable.length > 0 ? (
            <div>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Notable variances</h4>
              <TableWrap>
                <Thead>
                  <Th>Principal</Th>
                  <Th align="right">Weekly Rollup</Th>
                  <Th align="right">Monthly Target</Th>
                  <Th>Status</Th>
                </Thead>
                <tbody>
                  {notable.map((p) => (
                    <tr key={p.principal}>
                      <Td>{p.principal}</Td>
                      <Td align="right">{formatCompact(p.weeklySum)}</Td>
                      <Td align="right">{p.monthlyValue !== null ? formatCompact(p.monthlyValue) : "N/T"}</Td>
                      <Td>
                        <span className={STATUS_META[p.status].className}>{STATUS_META[p.status].label}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
