import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownReps, getKnownPrincipals } from "@/lib/adminReference";
import {
  createTeamLeaderAction,
  renameTeamLeaderAction,
  deleteTeamLeaderAction,
  createAssignmentAction,
  deleteAssignmentAction,
} from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

export default async function AdminTeamLeadersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; rename?: string; teamLeaderId?: string; principal?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, rename, teamLeaderId: lastTeamLeaderId, principal: lastPrincipal } = await searchParams;

  const [teamLeaders, assignments, knownReps, knownPrincipals] = await Promise.all([
    prisma.teamLeader.findMany({ orderBy: { name: "asc" } }),
    prisma.teamLeaderAssignment.findMany({ orderBy: [{ teamLeaderId: "asc" }, { principal: "asc" }, { employeeName: "asc" }] }),
    getKnownReps(),
    getKnownPrincipals(),
  ]);

  const renaming = rename ? teamLeaders.find((tl) => tl.id === rename) : undefined;

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const assignmentsByTeamLeader = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByTeamLeader.get(a.teamLeaderId) ?? [];
    list.push(a);
    assignmentsByTeamLeader.set(a.teamLeaderId, list);
  }

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

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Team Leader roster</h2>
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
                <div key={tl.id} className="flex items-center justify-between rounded-xl bg-background-elevated px-4 py-2.5">
                  <span className="text-sm font-medium text-foreground">
                    {tl.name}
                    <span className="ml-2 text-[13px] text-muted">
                      {(assignmentsByTeamLeader.get(tl.id) ?? []).length} assignment(s)
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
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
            <div className="sm:col-span-4">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add assignment
              </button>
            </div>
          </form>

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
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Assignments ({assignments.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Team Leader</th>
                  <th className="px-6 py-3 text-left font-medium">Rep</th>
                  <th className="px-6 py-3 text-left font-medium">Principal</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <tr key={a.id}>
                    <td className="px-6 py-3 border-b border-border/60">{teamLeaderNameById.get(a.teamLeaderId) ?? "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60">
                      {a.employeeName} <span className="text-muted">({a.employeeCode})</span>
                    </td>
                    <td className="px-6 py-3 border-b border-border/60">{a.principal}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">
                      <form action={deleteAssignmentAction} className="inline">
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300"
                        >
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {assignments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted">
                      No assignments yet.
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
