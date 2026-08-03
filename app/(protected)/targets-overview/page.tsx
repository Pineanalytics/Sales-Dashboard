import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { getTargetsOverview } from "@/lib/targetsOverview";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { updateTargetValueAction, updateAssignmentMetadataAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

function fmtPct(value: number | null): string {
  return value != null ? `${(value * 100).toFixed(1)}%` : "—";
}
function fmtNum(value: number | null): string {
  return value != null ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—";
}

export default async function TargetsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    year?: string;
    month?: string;
    principal?: string;
    teamLeaderId?: string;
    employeeCode?: string;
    region?: string;
    editTarget?: string; // "<principal>::<month>"
    editAssignment?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) {
    redirect("/");
  }
  const user = session.user;
  const isAdmin = user.role === "ADMIN";

  const params = await searchParams;
  const now = new Date();
  const year = params.year || String(now.getFullYear());
  const month = params.month ?? CANONICAL_MONTHS[now.getMonth()];
  const filters = {
    year,
    month: month || undefined,
    principal: params.principal || undefined,
    teamLeaderId: params.teamLeaderId || undefined,
    employeeCode: params.employeeCode || undefined,
    region: params.region || undefined,
  };

  const scope = await resolveScopeForSession(user.role, user.teamLeaderId ?? null);
  const [{ targetRows, rosterRows, principals, teamLeaders, regions }, targetYears] = await Promise.all([
    getTargetsOverview(filters, scope),
    prisma.target.findMany({ select: { year: true }, distinct: ["year"] }),
  ]);
  const years = Array.from(new Set([...targetYears.map((t) => t.year), year])).sort();

  const editingTargetKey = params.editTarget;
  const editingAssignmentId = params.editAssignment;

  // Hidden fields carrying the active filter bar through every edit form's
  // round-trip — see actions.ts's filterSuffix, which reads these back off.
  const filterHiddenFields = (
    <>
      <input type="hidden" name="filter_year" value={year} />
      <input type="hidden" name="filter_month" value={month} />
      {params.principal ? <input type="hidden" name="filter_principal" value={params.principal} /> : null}
      {params.teamLeaderId ? <input type="hidden" name="filter_teamLeaderId" value={params.teamLeaderId} /> : null}
      {params.employeeCode ? <input type="hidden" name="filter_employeeCode" value={params.employeeCode} /> : null}
      {params.region ? <input type="hidden" name="filter_region" value={params.region} /> : null}
    </>
  );
  const filterQueryString = [
    `year=${encodeURIComponent(year)}`,
    month ? `month=${encodeURIComponent(month)}` : "",
    params.principal ? `principal=${encodeURIComponent(params.principal)}` : "",
    params.teamLeaderId ? `teamLeaderId=${encodeURIComponent(params.teamLeaderId)}` : "",
    params.employeeCode ? `employeeCode=${encodeURIComponent(params.employeeCode)}` : "",
    params.region ? `region=${encodeURIComponent(params.region)}` : "",
  ]
    .filter(Boolean)
    .join("&");

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/weekly-targets" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to Weekly Targets
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Targets Overview</h1>
        <p className="mt-1 text-sm text-white/70">
          Monthly Targets per principal alongside the Roster that splits them down to individual reps — filter by Employee, Principal,
          Month, Team Leader, or Region. {isAdmin ? "As an admin, you can edit any row." : "You can edit any principal you're assigned to, and your own reps' roster details."}
        </p>
      </div>

      <div className="max-w-6xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {params.error ? (
          <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {params.error}
          </p>
        ) : null}
        {params.success ? (
          <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {params.success}
          </p>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Year</label>
              <select name="year" defaultValue={year} className={inputClass}>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Month</label>
              <select name="month" defaultValue={month} className={inputClass}>
                <option value="">All months</option>
                {CANONICAL_MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Principal</label>
              <select name="principal" defaultValue={params.principal ?? ""} className={inputClass}>
                <option value="">All principals</option>
                {principals.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Team Leader</label>
              <select name="teamLeaderId" defaultValue={params.teamLeaderId ?? ""} className={inputClass}>
                <option value="">All Team Leaders</option>
                {teamLeaders.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Region</label>
              <select name="region" defaultValue={params.region ?? ""} className={inputClass}>
                <option value="">All Regions</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Employee</label>
              <input name="employeeCode" defaultValue={params.employeeCode ?? ""} placeholder="Code or exact name" className={inputClass} />
            </div>
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white">
              Filter
            </button>
            <Link href="/targets-overview" className="rounded-full px-4 py-3 text-xs font-medium text-muted-strong hover:bg-background-elevated">
              Clear filters
            </Link>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Monthly Targets ({targetRows.length})</h2>
            <p className="mt-1 text-[13px] text-muted">
              Company-wide, per principal/month — shared across every Team Leader assigned to that principal.
            </p>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Principal</th>
                  <th className="px-6 py-3 text-left font-medium">Month</th>
                  <th className="px-6 py-3 text-right font-medium">Value Target</th>
                  <th className="px-6 py-3 text-right font-medium">Volume Target</th>
                  <th className="px-6 py-3 text-right font-medium">Coverage Target</th>
                  <th className="px-6 py-3 text-right font-medium">Productivity Target</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targetRows.map((t) => {
                  const key = `${t.principal}::${t.month}`;
                  const canEdit = isAdmin || (scope ? scope.principals.includes(t.principal) : false);
                  if (editingTargetKey === key) {
                    return (
                      <tr key={key}>
                        <td className="px-6 py-3 border-b border-border/60" colSpan={7}>
                          <form action={updateTargetValueAction} className="flex flex-wrap items-end gap-3">
                            {filterHiddenFields}
                            <input type="hidden" name="year" value={t.year} />
                            <input type="hidden" name="month" value={t.month} />
                            <input type="hidden" name="principal" value={t.principal} />
                            <span className="text-sm font-medium text-foreground">
                              {t.principal} — {t.month} {t.year}
                            </span>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Value Target</label>
                              <input name="valueTarget" type="number" step="0.01" defaultValue={t.valueTarget ?? ""} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Volume Target</label>
                              <input name="volumeTarget" type="number" step="0.01" defaultValue={t.volumeTarget ?? ""} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Coverage Target</label>
                              <input name="coverageTarget" type="number" step="0.01" defaultValue={t.coverageTarget ?? ""} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Productivity Target</label>
                              <input name="productivityTarget" type="number" step="0.01" defaultValue={t.productivityTarget ?? ""} className={inputClass} />
                            </div>
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href={`/targets-overview?${filterQueryString}`} className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </form>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={key}>
                      <td className="px-6 py-3 border-b border-border/60">
                        {t.principal}
                        {t.sharedWithTeamLeaderCount > 1 ? (
                          <span className="ml-2 rounded-full bg-accent-amber-soft px-2 py-0.5 text-[11px] font-medium text-accent-amber">
                            Shared with {t.sharedWithTeamLeaderCount - 1} other Team Leader{t.sharedWithTeamLeaderCount - 1 > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-6 py-3 border-b border-border/60">{t.month}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{fmtNum(t.valueTarget)}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{fmtNum(t.volumeTarget)}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{fmtNum(t.coverageTarget)}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{fmtNum(t.productivityTarget)}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">
                        {canEdit ? (
                          <Link
                            href={`/targets-overview?${filterQueryString}&editTarget=${encodeURIComponent(key)}`}
                            className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                          >
                            Edit
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {targetRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-muted">
                      No targets match this filter.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Roster ({rosterRows.length})</h2>
            <p className="mt-1 text-[13px] text-muted">
              One row per rep × principal. Pro-rata Value Target only shows when a single Month is selected above.
            </p>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Rep</th>
                  <th className="px-6 py-3 text-left font-medium">Team Leader</th>
                  <th className="px-6 py-3 text-left font-medium">Principal</th>
                  <th className="px-6 py-3 text-left font-medium">Region</th>
                  <th className="px-6 py-3 text-left font-medium">Channel</th>
                  <th className="px-6 py-3 text-right font-medium">Contribution %</th>
                  <th className="px-6 py-3 text-right font-medium">Pro-Rata Value Target</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rosterRows.map((r) => {
                  const canEdit = isAdmin || r.teamLeaderId === user.teamLeaderId;
                  if (editingAssignmentId === r.assignmentId) {
                    return (
                      <tr key={r.assignmentId}>
                        <td className="px-6 py-3 border-b border-border/60" colSpan={8}>
                          <form action={updateAssignmentMetadataAction} className="flex flex-wrap items-end gap-3">
                            {filterHiddenFields}
                            <input type="hidden" name="assignmentId" value={r.assignmentId} />
                            <span className="text-sm font-medium text-foreground">
                              {r.employeeName} ({r.employeeCode}) — {r.principal}
                            </span>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Channel</label>
                              <input name="channel" defaultValue={r.channel ?? ""} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Contribution %</label>
                              <input
                                name="contributionPct"
                                type="number"
                                min="0"
                                max="100"
                                step="0.01"
                                defaultValue={r.contributionPct != null ? (r.contributionPct * 100).toFixed(2) : ""}
                                className={inputClass}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Region</label>
                              <input name="region" defaultValue={r.region ?? ""} className={inputClass} />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className={labelClass}>Sub Region</label>
                              <input name="subRegion" defaultValue={r.subRegion ?? ""} className={inputClass} />
                            </div>
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href={`/targets-overview?${filterQueryString}`} className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </form>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={r.assignmentId}>
                      <td className="px-6 py-3 border-b border-border/60">
                        {r.employeeName} <span className="text-muted">({r.employeeCode})</span>
                      </td>
                      <td className="px-6 py-3 border-b border-border/60">{r.teamLeaderName}</td>
                      <td className="px-6 py-3 border-b border-border/60">{r.principal}</td>
                      <td className="px-6 py-3 border-b border-border/60">{r.region ?? "—"}{r.subRegion ? ` / ${r.subRegion}` : ""}</td>
                      <td className="px-6 py-3 border-b border-border/60">{r.channel ?? "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{fmtPct(r.contributionPct)}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">{fmtNum(r.employeeProRataValue)}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">
                        {canEdit ? (
                          <Link
                            href={`/targets-overview?${filterQueryString}&editAssignment=${r.assignmentId}`}
                            className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                          >
                            Edit
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {rosterRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-8 text-center text-muted">
                      No roster rows match this filter.
                    </td>
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
