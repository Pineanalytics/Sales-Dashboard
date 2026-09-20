"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { updateAssignmentAction, deactivateAssignmentAction, deleteAssignmentAction } from "./actions";
import { principalsForTeamLeader, assignmentsForTeamLeaderAndPrincipal } from "@/lib/rosterCascade";

export interface CascadeAssignmentRow {
  id: string;
  teamLeaderId: string;
  employeeCode: string;
  employeeName: string;
  principal: string;
  channel: string | null;
  contributionPct: number | null;
  salesRole: string;
  active: boolean;
}
export interface CascadeTeamLeader {
  id: string;
  name: string;
  supervisorId: string | null;
}
export interface CascadeSupervisor {
  id: string;
  name: string;
}

/** The admin/team-leaders "Assignments" table: a dynamic Team Leader ->
 *  Principal cascade (picking a Team Leader narrows the Principal options to
 *  only the ones that Team Leader actually has reps under, via
 *  lib/rosterCascade.ts's pure helpers) plus an orthogonal "jump to a rep"
 *  search that shows every assignment for a matching employee code/name
 *  across every Team Leader/Principal at once — a rep who serves more than
 *  one Team Leader or Principal has no other single place to see that today.
 *  All filtering happens client-side over the already scope-filtered
 *  `assignments` the server page fetched once; the URL is kept in sync
 *  (shallow, no refetch) purely so the current view stays a bookmarkable/
 *  shareable link, matching the page's pre-existing query-param convention
 *  for edit/rename links. Editing itself is unchanged from before this
 *  cascade existed: click a row's Edit link to swap it for the same inline
 *  form, submitted through the same server actions. */
export function RosterAssignmentsCascade({
  assignments,
  teamLeaders,
  supervisors,
  knownPrincipals,
  initialTeamLeaderId,
  initialPrincipal,
  initialEmployeeSearch,
  editingId,
  inputClass,
  labelClass,
}: {
  assignments: CascadeAssignmentRow[];
  teamLeaders: CascadeTeamLeader[];
  supervisors: CascadeSupervisor[];
  knownPrincipals: string[];
  initialTeamLeaderId: string;
  initialPrincipal: string;
  initialEmployeeSearch: string;
  editingId?: string;
  inputClass: string;
  labelClass: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [teamLeaderId, setTeamLeaderId] = useState(initialTeamLeaderId);
  const [principal, setPrincipal] = useState(initialPrincipal);
  const [search, setSearch] = useState(initialEmployeeSearch);

  const teamLeaderNameById = useMemo(() => new Map(teamLeaders.map((tl) => [tl.id, tl.name])), [teamLeaders]);
  const supervisorNameById = useMemo(() => new Map(supervisors.map((s) => [s.id, s.name])), [supervisors]);
  const principalOptions = useMemo(
    () => (teamLeaderId ? principalsForTeamLeader(assignments, teamLeaderId) : knownPrincipals),
    [assignments, teamLeaderId, knownPrincipals]
  );

  const searching = search.trim().length > 0;
  const rows = useMemo(() => {
    if (searching) {
      const needle = search.trim().toLowerCase();
      return assignments.filter((a) => a.employeeCode.toLowerCase().includes(needle) || a.employeeName.toLowerCase().includes(needle));
    }
    if (teamLeaderId && principal) return assignmentsForTeamLeaderAndPrincipal(assignments, teamLeaderId, principal);
    if (teamLeaderId) return assignments.filter((a) => a.teamLeaderId === teamLeaderId);
    if (principal) return assignments.filter((a) => a.principal === principal);
    return assignments;
  }, [assignments, searching, search, teamLeaderId, principal]);

  const isFiltered = Boolean(teamLeaderId || principal || searching);

  function syncUrl(next: { teamLeaderId: string; principal: string; search: string }) {
    const params = new URLSearchParams();
    if (next.teamLeaderId) params.set("filterTeamLeader", next.teamLeaderId);
    if (next.principal) params.set("filterPrincipal", next.principal);
    if (next.search) params.set("filterEmployee", next.search);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function handleTeamLeaderChange(value: string) {
    // A Principal chosen under the previous Team Leader may not exist under
    // the new one — clear it rather than silently showing an empty table.
    const nextPrincipal = value && principal && !principalsForTeamLeader(assignments, value).includes(principal) ? "" : principal;
    setTeamLeaderId(value);
    setPrincipal(nextPrincipal);
    syncUrl({ teamLeaderId: value, principal: nextPrincipal, search });
  }
  function handlePrincipalChange(value: string) {
    setPrincipal(value);
    syncUrl({ teamLeaderId, principal: value, search });
  }
  function handleSearchChange(value: string) {
    setSearch(value);
    syncUrl({ teamLeaderId, principal, search: value });
  }
  function clearAll() {
    setTeamLeaderId("");
    setPrincipal("");
    setSearch("");
    router.replace(pathname, { scroll: false });
  }

  const filterSuffix = (() => {
    const params = new URLSearchParams();
    if (teamLeaderId) params.set("filterTeamLeader", teamLeaderId);
    if (principal) params.set("filterPrincipal", principal);
    if (search) params.set("filterEmployee", search);
    const query = params.toString();
    return query ? `&${query}` : "";
  })();
  const FilterFields = () => (
    <>
      {teamLeaderId ? <input type="hidden" name="filterTeamLeader" value={teamLeaderId} /> : null}
      {principal ? <input type="hidden" name="filterPrincipal" value={principal} /> : null}
      {search ? <input type="hidden" name="filterEmployee" value={search} /> : null}
    </>
  );

  const selectedTeamLeader = teamLeaderId ? teamLeaders.find((tl) => tl.id === teamLeaderId) : undefined;

  return (
    <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="p-6 pb-0 flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold text-primary-blue">
          Assignments ({rows.length}
          {isFiltered ? ` of ${assignments.length} total` : ""})
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <select value={teamLeaderId} onChange={(event) => handleTeamLeaderChange(event.target.value)} className={inputClass}>
            <option value="">All Team Leaders</option>
            {teamLeaders.map((tl) => (
              <option key={tl.id} value={tl.id}>
                {tl.name}
              </option>
            ))}
          </select>
          <select
            value={principal}
            onChange={(event) => handlePrincipalChange(event.target.value)}
            disabled={searching}
            className={inputClass}
          >
            <option value="">{teamLeaderId ? "All Principals for this Team Leader" : "All Principals"}</option>
            {principalOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            list="known-reps-codes"
            placeholder="Search by employee code or name"
            className={inputClass}
          />
          {isFiltered ? (
            <button type="button" onClick={clearAll} className="rounded-full px-3 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
              Clear filter
            </button>
          ) : null}
        </div>
      </div>
      {teamLeaderId && !searching ? (
        <p className="px-6 pt-2 text-[13px] text-muted">
          Reports to:{" "}
          {selectedTeamLeader?.supervisorId ? supervisorNameById.get(selectedTeamLeader.supervisorId) ?? "—" : <span className="text-accent-amber">no Supervisor</span>}
        </p>
      ) : null}
      {searching ? (
        <p className="px-6 pt-2 text-[13px] text-muted">
          Showing every assignment matching &quot;{search}&quot;, across every Team Leader and Principal.
        </p>
      ) : null}
      <div className="overflow-x-auto mt-4">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-6 py-3 text-left font-medium">Team Leader</th>
              <th className="px-6 py-3 text-left font-medium">Rep</th>
              <th className="px-6 py-3 text-left font-medium">Principal</th>
              <th className="px-6 py-3 text-left font-medium">Channel</th>
              <th className="px-6 py-3 text-right font-medium">Contribution %</th>
              <th className="px-6 py-3 text-left font-medium">Sales role</th>
              <th className="px-6 py-3 text-left font-medium">Status</th>
              <th className="px-6 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) =>
              editingId === a.id ? (
                <tr key={a.id}>
                  <td className="px-6 py-3 border-b border-border/60" colSpan={8}>
                    <form action={updateAssignmentAction} className="flex flex-wrap items-end gap-3">
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <FilterFields />
                      <span className="text-sm font-medium text-foreground">
                        {a.employeeName} ({a.employeeCode}) — {a.principal}
                      </span>
                      <div className="flex flex-col gap-1">
                        <label className={labelClass}>Channel</label>
                        <input name="channel" defaultValue={a.channel ?? ""} placeholder="KA" className={inputClass} />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className={labelClass}>Contribution %</label>
                        <input
                          name="contributionPct"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          defaultValue={a.contributionPct != null ? (a.contributionPct * 100).toFixed(2) : ""}
                          className={inputClass}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className={labelClass}>Sales role</label>
                        <select name="salesRole" defaultValue={a.salesRole} className={inputClass}>
                          <option value="PRIMARY">Primary</option>
                          <option value="SECONDARY">Secondary</option>
                        </select>
                      </div>
                      <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                        Save
                      </button>
                      <Link
                        href={`/admin/team-leaders?${filterSuffix.replace(/^&/, "")}`}
                        className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated"
                      >
                        Cancel
                      </Link>
                    </form>
                  </td>
                </tr>
              ) : (
                <tr key={a.id} className={a.active ? undefined : "opacity-50"}>
                  <td className="px-6 py-3 border-b border-border/60">{teamLeaderNameById.get(a.teamLeaderId) ?? "—"}</td>
                  <td className="px-6 py-3 border-b border-border/60">
                    {a.employeeName} <span className="text-muted">({a.employeeCode})</span>
                  </td>
                  <td className="px-6 py-3 border-b border-border/60">{a.principal}</td>
                  <td className="px-6 py-3 border-b border-border/60">{a.channel ?? "—"}</td>
                  <td className="px-6 py-3 border-b border-border/60 text-right">
                    {a.contributionPct != null ? `${(a.contributionPct * 100).toFixed(1)}%` : <span className="text-muted">not declared</span>}
                  </td>
                  <td className="px-6 py-3 border-b border-border/60">{a.salesRole === "PRIMARY" ? "Primary" : "Secondary"}</td>
                  <td className="px-6 py-3 border-b border-border/60">
                    {a.active ? <span className="text-accent-green">Active</span> : <span className="text-accent-red">Inactive</span>}
                  </td>
                  <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                    <Link
                      href={`/admin/team-leaders?edit=${a.id}${filterSuffix}`}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                    >
                      Edit
                    </Link>
                    <form action={deactivateAssignmentAction} className="inline">
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <FilterFields />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-amber hover:bg-accent-amber-soft transition-colors duration-300"
                      >
                        {a.active ? "Deactivate" : "Reactivate"}
                      </button>
                    </form>
                    <form action={deleteAssignmentAction} className="inline">
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <FilterFields />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300"
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              )
            )}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-6 py-8 text-center text-muted">
                  {isFiltered ? "No assignments match this filter." : "No assignments yet."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
