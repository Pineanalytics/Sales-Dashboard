import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownReps, getKnownPrincipals } from "@/lib/adminReference";
import { validateContributionTotals } from "@/lib/repContribution";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import {
  createTeamLeaderAction,
  renameTeamLeaderAction,
  deleteTeamLeaderAction,
  updateTeamLeaderSupervisorAction,
  updateSupervisorManagerAction,
  createAssignmentAction,
  updateAssignmentAction,
  deactivateAssignmentAction,
  deleteAssignmentAction,
  uploadRosterCsvAction,
} from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

export default async function AdminTeamLeadersPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    success?: string;
    rename?: string;
    edit?: string;
    teamLeaderId?: string;
    principal?: string;
    filterTeamLeader?: string;
    filterEmployee?: string;
  }>;
}) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "SUPERVISOR")) {
    redirect("/");
  }
  const isAdmin = session.user.role === "ADMIN";
  const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId, session.user.allowedPrincipals, session.user.supervisorId);

  const {
    error,
    success,
    rename,
    edit,
    teamLeaderId: lastTeamLeaderId,
    principal: lastPrincipal,
    filterTeamLeader,
    filterEmployee,
  } = await searchParams;

  const [teamLeaders, assignments, knownReps, knownPrincipals, supervisors, managers] = await Promise.all([
    prisma.teamLeader.findMany({ where: scope ? { id: { in: scope.teamLeaderIds } } : {}, orderBy: { name: "asc" } }),
    prisma.teamLeaderAssignment.findMany({
      where: scope ? { teamLeaderId: { in: scope.teamLeaderIds } } : {},
      orderBy: [{ teamLeaderId: "asc" }, { principal: "asc" }, { employeeName: "asc" }],
    }),
    getKnownReps(),
    getKnownPrincipals(),
    prisma.supervisor.findMany({ orderBy: { name: "asc" } }),
    prisma.manager.findMany({ orderBy: { name: "asc" } }),
  ]);

  const renaming = rename ? teamLeaders.find((tl) => tl.id === rename) : undefined;
  const editing = edit ? assignments.find((a) => a.id === edit) : undefined;
  const contributionWarnings = validateContributionTotals(assignments);

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const assignmentsByTeamLeader = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByTeamLeader.get(a.teamLeaderId) ?? [];
    list.push(a);
    assignmentsByTeamLeader.set(a.teamLeaderId, list);
  }

  // Narrows the Assignments table to one Team Leader's roster and/or one Employee's spread
  // across every Principal/Team Leader they're on — the same query-param-driven pattern the
  // page already uses for edit/rename, just filtering what's already fetched.
  const employeeNeedle = filterEmployee?.trim().toLowerCase();
  const visibleAssignments = assignments.filter((a) => {
    if (filterTeamLeader && a.teamLeaderId !== filterTeamLeader) return false;
    if (employeeNeedle && !a.employeeCode.toLowerCase().includes(employeeNeedle) && !a.employeeName.toLowerCase().includes(employeeNeedle))
      return false;
    return true;
  });
  const isFiltered = Boolean(filterTeamLeader || employeeNeedle);
  const filterQuery = `${filterTeamLeader ? `&filterTeamLeader=${encodeURIComponent(filterTeamLeader)}` : ""}${
    filterEmployee ? `&filterEmployee=${encodeURIComponent(filterEmployee)}` : ""
  }`;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Team Leaders</h1>
        <p className="mt-1 text-sm text-white/70">
          The roster and rep/principal assignment fact table that drives the Weekly Targets grid — a Team Leader only gets a Weekly
          entry row for a Principal once a rep of theirs is assigned to it here.
        </p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? (
          <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {success}
          </p>
        ) : null}

        {contributionWarnings.length > 0 ? (
          <div className="rounded-xl border-l-4 border-l-accent-amber bg-surface px-4 py-3 text-sm text-accent-amber shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            Declared Contribution % doesn&apos;t sum to 100% for:{" "}
            {contributionWarnings.map((w, i) => (
              <span key={w.principal}>
                {i > 0 ? ", " : ""}
                {w.principal} ({w.totalPct.toFixed(1)}%)
              </span>
            ))}
            .
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Upload Roster (CSV)</h2>
          <p className="mt-1 text-[13px] text-muted">
            Expects the Target_Management_System.xlsm workbook&apos;s own Roster sheet, exported as CSV (a single header row —
            Employee Code, Employee (Sales Edge Name), SAP Name, Channel, Team Leader, Principal, * Contribution %, Active
            (Y/N), and the rest of the reference columns). Every row is upserted; nothing is auto-deactivated.
          </p>
          <form action={uploadRosterCsvAction} className="mt-4 flex flex-wrap items-center gap-4">
            <input
              type="file"
              name="file"
              accept=".csv"
              required
              className="text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-background-elevated file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-blue hover:file:bg-accent-blue-soft"
            />
            <button
              type="submit"
              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Upload
            </button>
          </form>
        </div>

        {isAdmin ? (
        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Team Leader roster</h2>
          <p className="mt-1 text-[13px] text-muted">
            Creating/renaming/removing a Team Leader entity itself is admin-only — a Sales Supervisor manages the rep
            assignments under their existing Team Leaders below, not the Team Leaders themselves.
          </p>
          <form action={createTeamLeaderAction} className="mt-4 flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Name</label>
              <input name="name" required placeholder="Christine" className={inputClass} />
            </div>
            <button
              type="submit"
              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
            >
              Add Team Leader
            </button>
          </form>

          <div className="mt-5 flex flex-col gap-2">
            {teamLeaders.map((tl) =>
              renaming?.id === tl.id ? (
                <form key={tl.id} action={renameTeamLeaderAction} className="flex items-center gap-2">
                  <input type="hidden" name="teamLeaderId" value={tl.id} />
                  <input name="name" defaultValue={tl.name} className={inputClass} />
                  <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                    Save
                  </button>
                  <Link href="/admin/team-leaders" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                    Cancel
                  </Link>
                </form>
              ) : (
                <div key={tl.id} className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-background-elevated px-4 py-2.5">
                  <span className="text-sm font-medium text-foreground">
                    {tl.name}
                    <span className="ml-2 text-[13px] text-muted">
                      {(assignmentsByTeamLeader.get(tl.id) ?? []).length} assignment(s)
                    </span>
                  </span>
                  <div className="flex items-center gap-3 flex-wrap">
                    <form action={updateTeamLeaderSupervisorAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="teamLeaderId" value={tl.id} />
                      <span className="text-[13px] text-muted">Reports to</span>
                      <select name="supervisorId" defaultValue={tl.supervisorId ?? ""} className={inputClass + " py-1 text-xs"}>
                        <option value="">— none —</option>
                        {supervisors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                        Save
                      </button>
                    </form>
                    <Link
                      href={`/admin/team-leaders?rename=${tl.id}`}
                      className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                    >
                      Rename
                    </Link>
                    <form action={deleteTeamLeaderAction} className="inline">
                      <input type="hidden" name="teamLeaderId" value={tl.id} />
                      <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              )
            )}
            {teamLeaders.length === 0 ? <p className="text-sm text-muted">No Team Leaders yet — add one above.</p> : null}
          </div>
        </div>
        ) : null}

        {isAdmin ? (
        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Sales Supervisors → Manager</h2>
          <p className="mt-1 text-[13px] text-muted">
            Who each Sales Supervisor reports to — the reporting line TL Ranking&apos;s Manager rollup uses
            (Supervisor.managerId). Team Leaders/Supervisors themselves are still sourced from the Roster CSV
            upload above; this is only the Manager link.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {supervisors.map((s) => (
              <form key={s.id} action={updateSupervisorManagerAction} className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-background-elevated px-4 py-2.5">
                <input type="hidden" name="supervisorId" value={s.id} />
                <span className="text-sm font-medium text-foreground">{s.name}</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] text-muted">Reports to</span>
                  <select name="managerId" defaultValue={s.managerId ?? ""} className={inputClass + " py-1 text-xs"}>
                    <option value="">— none —</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                    Save
                  </button>
                </div>
              </form>
            ))}
            {supervisors.length === 0 ? <p className="text-sm text-muted">No Sales Supervisors yet — added via the Roster CSV upload.</p> : null}
          </div>
        </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Assign a rep to a Team Leader × Principal</h2>
          <p className="mt-1 text-[13px] text-muted">
            A rep can appear under multiple principals, and under different Team Leaders for different principals.
          </p>
          <form action={createAssignmentAction} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Team Leader</label>
              <select name="teamLeaderId" required defaultValue={lastTeamLeaderId ?? ""} className={inputClass}>
                <option value="" disabled>
                  Select
                </option>
                {teamLeaders.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Employee code</label>
              <input name="employeeCode" required list="known-reps-codes" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Employee name</label>
              <input name="employeeName" list="known-reps-names" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Principal</label>
              <select name="principal" defaultValue={lastPrincipal ?? ""} className={inputClass}>
                <option value="">— choose existing —</option>
                {knownPrincipals.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2 sm:col-start-4">
              <label className={labelClass}>Or a new Principal</label>
              <input name="newPrincipal" placeholder="Bic-Nairobi" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Channel</label>
              <input name="channel" placeholder="KA" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Contribution % (optional)</label>
              <input name="contributionPct" type="number" min="0" max="100" step="0.01" placeholder="e.g. 30.5" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Sales role</label>
              <select name="salesRole" defaultValue="PRIMARY" className={inputClass}>
                <option value="PRIMARY">Primary</option>
                <option value="SECONDARY">Secondary</option>
              </select>
            </div>
            <div className="sm:col-span-4">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add assignment
              </button>
            </div>
          </form>
          <p className="mt-2 text-[13px] text-muted">
            Contribution % is the admin-declared share of this rep&apos;s Team Leader&apos;s Weekly Target — leave blank to keep using the
            computed share (each rep&apos;s actual trailing-revenue share) until you&apos;re ready to declare one. Declared %s should sum to
            100% across a Principal&apos;s active reps.
          </p>

          <datalist id="known-reps-codes">
            {knownReps.map((r) => (
              <option key={r.employeeCode} value={r.employeeCode}>
                {r.employeeName}
              </option>
            ))}
          </datalist>
          <datalist id="known-reps-names">
            {knownReps.map((r) => (
              <option key={r.employeeCode} value={r.employeeName} />
            ))}
          </datalist>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0 flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-lg font-semibold text-primary-blue">
              Assignments ({visibleAssignments.length}
              {isFiltered ? ` of ${assignments.length} total` : ""})
            </h2>
            <form method="get" className="flex flex-wrap items-center gap-2">
              <select name="filterTeamLeader" defaultValue={filterTeamLeader ?? ""} className={inputClass}>
                <option value="">All Team Leaders</option>
                {teamLeaders.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
              <input
                name="filterEmployee"
                defaultValue={filterEmployee ?? ""}
                list="known-reps-codes"
                placeholder="Search by employee code or name"
                className={inputClass}
              />
              <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                Filter
              </button>
              {isFiltered ? (
                <Link href="/admin/team-leaders" className="rounded-full px-3 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                  Clear filter
                </Link>
              ) : null}
            </form>
          </div>
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
                {visibleAssignments.map((a) =>
                  editing?.id === a.id ? (
                    <tr key={a.id}>
                      <td className="px-6 py-3 border-b border-border/60" colSpan={8}>
                        <form action={updateAssignmentAction} className="flex flex-wrap items-end gap-3">
                          <input type="hidden" name="assignmentId" value={a.id} />
                          {filterTeamLeader ? <input type="hidden" name="filterTeamLeader" value={filterTeamLeader} /> : null}
                          {filterEmployee ? <input type="hidden" name="filterEmployee" value={filterEmployee} /> : null}
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
                            href={`/admin/team-leaders?${filterQuery.replace(/^&/, "")}`}
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
                        {a.active ? (
                          <span className="text-accent-green">Active</span>
                        ) : (
                          <span className="text-accent-red">Inactive</span>
                        )}
                      </td>
                      <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                        <Link
                          href={`/admin/team-leaders?edit=${a.id}${filterQuery}`}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Edit
                        </Link>
                        <form action={deactivateAssignmentAction} className="inline">
                          <input type="hidden" name="assignmentId" value={a.id} />
                          {filterTeamLeader ? <input type="hidden" name="filterTeamLeader" value={filterTeamLeader} /> : null}
                          {filterEmployee ? <input type="hidden" name="filterEmployee" value={filterEmployee} /> : null}
                          <button
                            type="submit"
                            className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-amber hover:bg-accent-amber-soft transition-colors duration-300"
                          >
                            {a.active ? "Deactivate" : "Reactivate"}
                          </button>
                        </form>
                        <form action={deleteAssignmentAction} className="inline">
                          <input type="hidden" name="assignmentId" value={a.id} />
                          {filterTeamLeader ? <input type="hidden" name="filterTeamLeader" value={filterTeamLeader} /> : null}
                          {filterEmployee ? <input type="hidden" name="filterEmployee" value={filterEmployee} /> : null}
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
                {visibleAssignments.length === 0 ? (
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
      </div>
    </div>
  );
}
