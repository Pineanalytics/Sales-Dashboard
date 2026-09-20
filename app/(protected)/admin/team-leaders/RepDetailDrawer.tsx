"use client";

import Link from "next/link";

export interface DrawerAssignmentRow {
  id: string;
  teamLeaderId: string;
  principal: string;
  channel: string | null;
  contributionPct: number | null;
  salesRole: string;
  active: boolean;
}
export interface DrawerIdentity {
  pineName: string;
  sapName: string;
  absolutePrincipal: string;
  salesRole: string;
  region: string | null;
  subRegion: string | null;
  active: boolean;
  teamLeaderId: string | null;
  supervisorId: string | null;
}
export interface DrawerContributionRow {
  principal: string;
  teamLeaderId: string | null;
  quarterRevenue: number;
  sharePct: number;
}

/** The single consolidated view of one rep, across every Team Leader and
 *  Principal they're rostered under at once — the direct answer to "a rep
 *  can serve more than one Team Leader/Principal, give a better way to see
 *  that in one place instead of browsing across several modules." Combines
 *  three sources that each own a different concern and stay genuinely
 *  separate, not merged into one row:
 *   - EmployeeMaster (Phase 5): this rep's canonical identity — one row,
 *     read-only here, edited only on /admin/employee-master.
 *   - TeamLeaderAssignment (Phase 0/1's own data): the full visibility/
 *     allocation set — however many rows, each still editable via the
 *     existing ?edit=<id> inline form on the Assignments table below.
 *   - RepContribution (Phase 3's fix): one correctly-attributed row per
 *     Team Leader relationship, instead of the pre-fix single mislabeled
 *     row a multi-Team-Leader rep used to collapse into. */
export function RepDetailDrawer({
  employeeCode,
  employeeName,
  identity,
  assignments,
  contributions,
  teamLeaderNameById,
  supervisorNameById,
  filterSuffix,
  onClose,
}: {
  employeeCode: string;
  employeeName: string;
  identity: DrawerIdentity | null;
  assignments: DrawerAssignmentRow[];
  contributions: DrawerContributionRow[];
  teamLeaderNameById: Map<string, string>;
  supervisorNameById: Map<string, string>;
  filterSuffix: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:p-8" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-2xl bg-surface p-6 shadow-[0_8px_30px_rgba(0,0,0,0.2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-muted">{employeeCode}</p>
            <h2 className="text-lg font-semibold text-primary-blue">{employeeName}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-strong hover:bg-background-elevated">
            Close
          </button>
        </div>

        <div className="mt-4 rounded-xl bg-background-elevated p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Employee Master identity</h3>
            <Link href={`/admin/employee-master?edit=${encodeURIComponent(employeeCode)}`} className="text-[13px] font-medium text-primary-blue hover:underline">
              Edit on Employee Master →
            </Link>
          </div>
          {identity ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-[12px] text-muted">Home Team Leader</dt>
                <dd className="font-medium text-foreground">
                  {identity.teamLeaderId ? teamLeaderNameById.get(identity.teamLeaderId) ?? identity.teamLeaderId : <span className="text-accent-amber">Unresolved</span>}
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Home Supervisor</dt>
                <dd className="font-medium text-foreground">{identity.supervisorId ? supervisorNameById.get(identity.supervisorId) ?? identity.supervisorId : "—"}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Absolute principal</dt>
                <dd className="font-medium text-foreground">{identity.absolutePrincipal}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Sales role</dt>
                <dd className="font-medium text-foreground">{identity.salesRole}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Region</dt>
                <dd className="font-medium text-foreground">{identity.region ?? "—"}{identity.subRegion ? ` / ${identity.subRegion}` : ""}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-muted">Status</dt>
                <dd className="font-medium">{identity.active ? <span className="text-accent-green">Active</span> : <span className="text-accent-red">Inactive</span>}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted">Not yet on the Employee Master roster.</p>
          )}
        </div>

        <div className="mt-4 rounded-xl bg-background-elevated p-4">
          <h3 className="text-sm font-semibold text-foreground">Assignments ({assignments.length})</h3>
          <p className="mt-1 text-[12px] text-muted">Every Team Leader × Principal this rep is rostered under. Close this and use the row&apos;s own Edit link to change one.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1.5 text-left font-medium">Team Leader</th>
                  <th className="py-1.5 text-left font-medium">Principal</th>
                  <th className="py-1.5 text-left font-medium">Channel</th>
                  <th className="py-1.5 text-right font-medium">Contribution %</th>
                  <th className="py-1.5 text-left font-medium">Role</th>
                  <th className="py-1.5 text-left font-medium">Status</th>
                  <th className="py-1.5 text-right font-medium">Edit</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id} className={a.active ? undefined : "opacity-50"}>
                    <td className="py-1.5 border-t border-border/60">{teamLeaderNameById.get(a.teamLeaderId) ?? "—"}</td>
                    <td className="py-1.5 border-t border-border/60">{a.principal}</td>
                    <td className="py-1.5 border-t border-border/60">{a.channel ?? "—"}</td>
                    <td className="py-1.5 border-t border-border/60 text-right">{a.contributionPct != null ? `${(a.contributionPct * 100).toFixed(1)}%` : "—"}</td>
                    <td className="py-1.5 border-t border-border/60">{a.salesRole === "PRIMARY" ? "Primary" : "Secondary"}</td>
                    <td className="py-1.5 border-t border-border/60">{a.active ? <span className="text-accent-green">Active</span> : <span className="text-accent-red">Inactive</span>}</td>
                    <td className="py-1.5 border-t border-border/60 text-right">
                      <Link href={`/admin/team-leaders?edit=${a.id}${filterSuffix}`} onClick={onClose} className="text-[13px] font-medium text-primary-blue hover:underline">
                        Edit →
                      </Link>
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-3 text-center text-muted">
                      No assignments.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-background-elevated p-4">
          <h3 className="text-sm font-semibold text-foreground">Trailing-revenue contribution</h3>
          <p className="mt-1 text-[12px] text-muted">Each Team Leader relationship&apos;s computed trailing-revenue share — the fallback used when a Contribution % isn&apos;t declared above.</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="text-[12px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1.5 text-left font-medium">Team Leader</th>
                  <th className="py-1.5 text-left font-medium">Principal</th>
                  <th className="py-1.5 text-right font-medium">Trailing revenue</th>
                  <th className="py-1.5 text-right font-medium">Computed share</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((c) => (
                  <tr key={`${c.teamLeaderId}-${c.principal}`}>
                    <td className="py-1.5 border-t border-border/60">{c.teamLeaderId ? teamLeaderNameById.get(c.teamLeaderId) ?? c.teamLeaderId : "—"}</td>
                    <td className="py-1.5 border-t border-border/60">{c.principal}</td>
                    <td className="py-1.5 border-t border-border/60 text-right">{c.quarterRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    <td className="py-1.5 border-t border-border/60 text-right">{(c.sharePct * 100).toFixed(1)}%</td>
                  </tr>
                ))}
                {contributions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-center text-muted">
                      No contribution data yet.
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
