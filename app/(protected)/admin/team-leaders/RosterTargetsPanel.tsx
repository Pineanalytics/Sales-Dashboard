import { saveWeeklyTargetsAction } from "@/app/(protected)/weekly-targets/actions";
import { updateTargetValueAction } from "@/app/(protected)/targets-overview/actions";

export interface RosterTargetsWeeklyRow {
  weekLabel: string;
  id: string | null;
  targetValue: number;
}

export interface RosterTargetsSupervisorShare {
  teamLeaderId: string;
  teamLeaderName: string;
  pct: number; // fraction
  valueShare: number; // KES — monthlyTarget.valueTarget * pct
  hasUndeclared: boolean;
}

export interface RosterTargetsSupervisorContribution {
  supervisorName: string;
  reconciled: boolean;
  totalPct: number; // fraction
  shares: RosterTargetsSupervisorShare[];
}

export interface RosterTargetsPanelData {
  teamLeaderId: string;
  teamLeaderName: string;
  principal: string;
  year: string;
  month: string;
  monthlyTarget: { valueTarget: number | null; volumeTarget: number | null } | null;
  sharedWithCount: number;
  canEditMonthlyTarget: boolean;
  weeklyRows: RosterTargetsWeeklyRow[];
  /** Only present when at least 2 Team Leaders share this Principal under the
   *  same Supervisor as the one currently selected — see
   *  lib/supervisorContribution.ts. Null otherwise (no Supervisor, or the
   *  Supervisor's only Team Leader on this Principal is the selected one). */
  supervisorContribution: RosterTargetsSupervisorContribution | null;
}

/** The Weekly/Monthly Target context for whichever Team Leader x Principal
 *  is currently selected in the Assignments cascade above — reuses the
 *  existing /weekly-targets and /targets-overview server actions unchanged,
 *  just as a second, scoped rendering surface for them (see
 *  lib/weeklyTargets.ts's ensureWeeklyTargetGrid, already decoupled from
 *  the full-grid page). Saving redirects back here (returnTo) instead of to
 *  either of those full pages. */
export function RosterTargetsPanel({ data, inputClass }: { data: RosterTargetsPanelData; inputClass: string }) {
  const returnTo = `/admin/team-leaders?filterTeamLeader=${data.teamLeaderId}&filterPrincipal=${encodeURIComponent(data.principal)}#assignments`;

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-primary-blue">
          Targets — {data.teamLeaderName} × {data.principal}
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          {data.month} {data.year}. Weekly figures feed the Daily Projection directly; the Monthly figure is the shared,
          principal-wide commitment{data.sharedWithCount > 1 ? ` (shared with ${data.sharedWithCount - 1} other Team Leader${data.sharedWithCount - 1 === 1 ? "" : "s"} on ${data.principal})` : ""}.
        </p>
      </div>

      <div className="rounded-xl bg-background-elevated p-4">
        <h3 className="text-sm font-semibold text-foreground">Monthly Target</h3>
        {data.canEditMonthlyTarget ? (
          <form action={updateTargetValueAction} className="mt-2 flex flex-wrap items-end gap-3">
            <input type="hidden" name="year" value={data.year} />
            <input type="hidden" name="month" value={data.month} />
            <input type="hidden" name="principal" value={data.principal} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex flex-col gap-1">
              <label className="text-[13px] font-medium text-muted-strong">Value Target</label>
              <input name="valueTarget" type="number" step="any" defaultValue={data.monthlyTarget?.valueTarget ?? ""} className={inputClass} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[13px] font-medium text-muted-strong">Volume Target</label>
              <input name="volumeTarget" type="number" step="any" defaultValue={data.monthlyTarget?.volumeTarget ?? ""} className={inputClass} />
            </div>
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
              Save
            </button>
          </form>
        ) : (
          <p className="mt-2 text-sm text-foreground">
            {data.monthlyTarget?.valueTarget != null ? data.monthlyTarget.valueTarget.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "Not set"}{" "}
            <a href="/targets-overview" className="ml-2 text-[13px] font-medium text-primary-blue hover:underline">
              Edit in Targets Overview →
            </a>
          </p>
        )}
      </div>

      {data.supervisorContribution ? (
        <div className="rounded-xl bg-background-elevated p-4">
          <h3 className="text-sm font-semibold text-foreground">
            {data.supervisorContribution.supervisorName}&apos;s split of {data.principal}
          </h3>
          <p className="mt-1 text-[13px] text-muted">
            The shared Monthly Target above, split by each Team Leader&apos;s own reps&apos; declared Contribution %.
            {data.supervisorContribution.reconciled ? (
              <span className="ml-1 text-accent-green">Reconciles to {(data.supervisorContribution.totalPct * 100).toFixed(1)}% — fully accounted for.</span>
            ) : (
              <span className="ml-1 text-accent-amber">
                {(data.supervisorContribution.totalPct * 100).toFixed(1)}% declared so far — not yet fully accounted for.
              </span>
            )}
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {data.supervisorContribution.shares.map((share) => (
              <div key={share.teamLeaderId} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm ${share.teamLeaderId === data.teamLeaderId ? "bg-accent-blue-soft" : ""}`}>
                <span className="font-medium text-foreground">{share.teamLeaderName}</span>
                <span className="text-muted">
                  {share.hasUndeclared ? (
                    <span className="text-accent-amber">not fully declared</span>
                  ) : (
                    <>
                      {(share.pct * 100).toFixed(1)}% · {share.valueShare.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl bg-background-elevated p-4">
        <h3 className="text-sm font-semibold text-foreground">Weekly Target</h3>
        <form action={saveWeeklyTargetsAction} className="mt-2 flex flex-wrap items-end gap-3">
          <input type="hidden" name="teamLeaderId" value={data.teamLeaderId} />
          <input type="hidden" name="year" value={data.year} />
          <input type="hidden" name="month" value={data.month} />
          <input type="hidden" name="returnTo" value={returnTo} />
          {data.weeklyRows.map((row) => (
            <div key={row.weekLabel} className="flex flex-col gap-1">
              <label className="text-[13px] font-medium text-muted-strong">{row.weekLabel}</label>
              {row.id ? (
                <input name={`cell__${row.id}`} type="number" step="any" defaultValue={row.targetValue || ""} className={inputClass} />
              ) : (
                <span className="text-muted">—</span>
              )}
            </div>
          ))}
          <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
            Save
          </button>
        </form>
      </div>
    </div>
  );
}
