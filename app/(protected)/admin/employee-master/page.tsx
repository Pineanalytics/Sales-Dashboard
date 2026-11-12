import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownPrincipals, getKnownSapSalesReps } from "@/lib/adminReference";
import { getDismissedRosterSuggestions, getTimestampRosterSuggestions } from "@/lib/employeeRosterSuggestions";
import { getUnresolvedEmployeeIdentities } from "@/lib/employeeIdentity";
import { AdminBadge, AdminCard, AdminDisclosure, AdminNotices, AdminPage, adminTable } from "@/components/admin/AdminPage";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import {
  saveEmployeeMasterAction,
  toggleEmployeeMasterActiveAction,
  resolveEmployeeIdentityAction,
  deleteEmployeeMasterAction,
  dismissRosterSuggestionAction,
  restoreRosterSuggestionAction,
} from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-xs font-semibold text-muted";

type RosterSearchParams = {
  success?: string;
  error?: string;
  edit?: string;
  add?: string;
  principal?: string;
  teamLeader?: string;
  q?: string;
};

export default async function EmployeeMasterPage({ searchParams }: { searchParams: Promise<RosterSearchParams> }) {
  const session = await auth();
  if (!session?.user || (session.user.role !== "ADMIN" && session.user.role !== "TEAM_LEADER")) redirect("/");

  const isAdmin = session.user.role === "ADMIN";
  const params = await searchParams;
  const teamLeader = !isAdmin && session.user.teamLeaderId
    ? await prisma.teamLeader.findUnique({ where: { id: session.user.teamLeaderId }, select: { id: true, name: true } })
    : null;
  if (!isAdmin && !teamLeader) redirect("/");

  const selectedPrincipal = params.principal?.trim() ?? "";
  const selectedTeamLeader = isAdmin ? params.teamLeader?.trim() ?? "" : "";
  const employeeQuery = params.q?.trim() ?? "";
  const [assignments, teamLeaders] = await Promise.all([
    !isAdmin
      ? prisma.teamLeaderAssignment.findMany({ where: { teamLeaderId: teamLeader!.id }, select: { employeeCode: true, principal: true } })
      : Promise.resolve([]),
    isAdmin ? prisma.teamLeader.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);

  const ownEmployeeCodes = assignments.map((row) => row.employeeCode);
  const ownPrincipals = Array.from(new Set(assignments.map((row) => row.principal)));
  const rosterWhere = {
    ...(isAdmin ? {} : { employeeCode: { in: ownEmployeeCodes } }),
    ...(selectedPrincipal ? { absolutePrincipal: selectedPrincipal } : {}),
    ...(selectedTeamLeader ? { teamLeader: selectedTeamLeader } : {}),
    ...(employeeQuery
      ? {
          OR: [
            { pineName: { contains: employeeQuery, mode: "insensitive" as const } },
            { sapName: { contains: employeeQuery, mode: "insensitive" as const } },
            { employeeCode: { contains: employeeQuery, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [employees, suggestions, knownPrincipals, sapSalesRepOptions, unresolvedIdentities, allDismissedSuggestions] = await Promise.all([
    prisma.employeeMaster.findMany({
      where: rosterWhere,
      include: { contributions: { orderBy: { principal: "asc" } } },
      orderBy: [{ active: "desc" }, { pineName: "asc" }],
    }),
    getTimestampRosterSuggestions(isAdmin ? undefined : ownPrincipals),
    getKnownPrincipals(),
    getKnownSapSalesReps(),
    isAdmin ? getUnresolvedEmployeeIdentities() : Promise.resolve([]),
    getDismissedRosterSuggestions(),
  ]);
  // A Team Leader sees (and can restore) only what they dismissed; an admin sees every dismissal.
  const dismissedSuggestions = isAdmin ? allDismissedSuggestions : allDismissedSuggestions.filter((row) => row.dismissedBy === session.user.email);
  // How many Team Leader assignments a Delete would take with it, for the confirmation (admin only — only admins can delete).
  const assignmentCountByCode = new Map(
    isAdmin
      ? (await prisma.teamLeaderAssignment.groupBy({ by: ["employeeCode"], where: { employeeCode: { in: [...employees.map((e) => e.employeeCode), ...unresolvedIdentities.map((rep) => rep.employeeCode)] } }, _count: { _all: true } })).map((row) => [row.employeeCode, row._count._all])
      : []
  );
  const deleteMessage = (name: string, code: string, assignmentCount: number) =>
    `Permanently delete ${name} (${code}) from the roster${assignmentCount > 0 ? ` together with ${assignmentCount} Team Leader assignment${assignmentCount === 1 ? "" : "s"}` : ""}? This can't be undone — Deactivate keeps the record instead.`;

  const teamLeaderNameById = new Map(teamLeaders.map((leader) => [leader.id, leader.name]));
  const editing = params.edit ? employees.find((employee) => employee.employeeCode === params.edit) : undefined;
  const addingSuggestion = params.add ? suggestions.find((suggestion) => suggestion.employeeCode === params.add) : undefined;
  const showForm = Boolean(editing || params.add === "new" || addingSuggestion);
  const formTitle = editing ? `Amend ${editing.pineName}` : addingSuggestion ? `Add suggested rep: ${addingSuggestion.salesRep}` : "Add employee";
  const teamLeaderOptions = Array.from(new Set([...teamLeaders.map((leader) => leader.name), ...(editing?.teamLeader ? [editing.teamLeader] : [])])).sort();
  const principalOptions = Array.from(new Set([...knownPrincipals, editing?.absolutePrincipal, addingSuggestion?.suggestedPrincipal].filter((value): value is string => Boolean(value)))).sort();
  const sapOptions = Array.from(new Set([...sapSalesRepOptions, editing?.sapName].filter((value): value is string => Boolean(value)))).sort();
  const suggestedSapName = addingSuggestion && sapOptions.includes(addingSuggestion.salesRep) ? addingSuggestion.salesRep : "";
  const rosterPrincipalOptions = isAdmin ? knownPrincipals : ownPrincipals;
  const filtersActive = Boolean(selectedPrincipal || selectedTeamLeader || employeeQuery);

  const activeCount = employees.filter((employee) => employee.active).length;

  return <AdminPage
    title="Employee Roster"
    description={isAdmin ? "Maintain Pine and SAP names, absolute principal, sales role, and team ownership. Timestamp suggestions always need a reviewer's confirmation." : `Add and amend the reps assigned to ${teamLeader!.name}.`}
    back={isAdmin ? { href: "/admin", label: "Back to admin" } : { href: "/dashboard", label: "Back to dashboard" }}
    stats={[
      { label: filtersActive ? "matching" : isAdmin ? "employees" : "reps", value: employees.length },
      { label: "active", value: activeCount },
      ...(suggestions.length > 0 ? [{ label: "suggestions", value: suggestions.length, tone: "attention" as const }] : []),
      ...(unresolvedIdentities.length > 0 ? [{ label: "unresolved", value: unresolvedIdentities.length, tone: "attention" as const }] : []),
    ]}
    actions={<Link href="/admin/employee-master?add=new" className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">+ Add employee</Link>}
  >
      <AdminNotices error={params.error} success={params.success} />

      {showForm ? <section className="rounded-2xl border border-secondary-blue/30 bg-surface p-5 shadow-[0_6px_18px_rgba(11,61,53,0.1)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-blue">{editing ? "Edit roster record" : "New roster record"}</p>
            <h2 className="mt-1 text-lg font-bold text-brand-navy">{formTitle}</h2>
            {addingSuggestion ? <p className="mt-1 text-xs text-muted">Suggested from {addingSuggestion.productiveCalls.toLocaleString()} productive timestamp call(s) and {addingSuggestion.sales.toLocaleString("en-KE", { style: "currency", currency: "KES", notation: "compact" })} sold over the past 90 days.</p> : null}
          </div>
          <Link href="/admin/employee-master" className="text-xs font-semibold text-primary-blue hover:underline">Cancel</Link>
        </div>
        <form action={saveEmployeeMasterAction} className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className={labelClass}>Employee code<input name="employeeCode" required readOnly={Boolean(editing)} defaultValue={editing?.employeeCode ?? addingSuggestion?.employeeCode ?? ""} className={`${inputClass} ${editing ? "bg-background-elevated text-muted" : ""}`} /></label>
          <label className={labelClass}>Pine / SalesEdge name<input name="pineName" required defaultValue={editing?.pineName ?? addingSuggestion?.salesRep ?? ""} className={inputClass} /></label>
          <label className={labelClass}>SAP sales rep name<input name="sapName" list="sap-sales-rep-options" required defaultValue={editing?.sapName ?? suggestedSapName} placeholder="Search SAP sales employees…" autoComplete="off" className={inputClass} /><span className="mt-1 block text-[11px] text-muted">Search and select the name sent by the live SAP sales feed.</span></label>
          <label className={labelClass}>Absolute principal<input name="absolutePrincipal" list="principal-options" required defaultValue={editing?.absolutePrincipal ?? addingSuggestion?.suggestedPrincipal ?? ""} placeholder="Search available principals…" autoComplete="off" className={inputClass} /><span className="mt-1 block text-[11px] text-muted">Select an available system principal. A timestamp suggestion is pre-filled for review.</span></label>
          <label className={labelClass}>Sales role<select name="salesRole" defaultValue={editing?.salesRole ?? "Primary Sales"} className={inputClass}><option>Primary Sales</option><option>Secondary Sales</option></select></label>
          {isAdmin ? <label className={labelClass}>Team Leader<select name="teamLeader" required defaultValue={editing?.teamLeader ?? ""} className={inputClass}><option value="">Select Team Leader</option>{teamLeaderOptions.map((name) => <option key={name}>{name}</option>)}</select></label> : <label className={labelClass}>Team Leader<input readOnly value={teamLeader!.name} className={`${inputClass} bg-background-elevated text-muted`} /><input type="hidden" name="teamLeader" value={teamLeader!.name} /></label>}
          <datalist id="principal-options">{principalOptions.map((principal) => <option key={principal} value={principal} />)}</datalist>
          <datalist id="sap-sales-rep-options">{sapOptions.map((sapName) => <option key={sapName} value={sapName} />)}</datalist>
          <div className="flex items-end"><button type="submit" className="w-full rounded-full bg-primary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue">{editing ? "Save changes" : "Add to roster"}</button></div>
        </form>
      </section> : null}

      {suggestions.length > 0 || unresolvedIdentities.length > 0 || dismissedSuggestions.length > 0 ? <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      {suggestions.length > 0 ? <AdminDisclosure
        defaultOpen
        title="New reps seen in productive calls"
        badge={<AdminBadge tone="attention">{suggestions.length} to review</AdminBadge>}
        description="The suggested principal is the most frequent sales cost centre in the last 90 days. It is not applied until you add the rep."
      >
        <div className="grid max-h-[460px] gap-3 overflow-y-auto sm:grid-cols-2 2xl:grid-cols-3">{suggestions.map((suggestion) => <div key={suggestion.employeeCode} className="rounded-xl border border-border bg-background-elevated/35 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-brand-navy">{suggestion.salesRep}</p><p className="text-xs text-muted">{suggestion.employeeCode}</p></div><span className="rounded-full bg-accent-green-soft px-2 py-0.5 text-[10px] font-semibold text-accent-green">{suggestion.productiveCalls} sales</span></div><p className="mt-3 text-xs text-muted">Suggested absolute principal</p><p className="text-sm font-semibold text-secondary-blue">{suggestion.suggestedPrincipal}</p><p className="mt-1 text-[11px] text-muted">Last call {suggestion.latestCallDate.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Link href={`/admin/employee-master?add=${encodeURIComponent(suggestion.employeeCode)}`} className="inline-flex rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-surface-hover">Review and add</Link><form action={dismissRosterSuggestionAction}><input type="hidden" name="employeeCode" value={suggestion.employeeCode} /><input type="hidden" name="salesRep" value={suggestion.salesRep} /><button type="submit" title="Not a rep to add (a test login, a van code, someone who has left). You can restore it below." className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-strong hover:bg-background-elevated">Dismiss</button></form></div></div>)}</div>
      </AdminDisclosure> : null}

      {unresolvedIdentities.length > 0 ? <AdminDisclosure
        defaultOpen
        title="Reps with no single home Team Leader"
        badge={<AdminBadge tone="attention">{unresolvedIdentities.length} to review</AdminBadge>}
        description="Most reps resolve automatically from their Team Leader assignment(s). These have none, or genuinely more than one: pick the correct home Team Leader."
      >
        <div className="grid max-h-[460px] gap-3 overflow-y-auto sm:grid-cols-2 2xl:grid-cols-3">
          {unresolvedIdentities.map((rep) => (
            <div key={rep.employeeCode} className="flex flex-col rounded-xl border border-border bg-background-elevated/35 p-3">
              <p className="font-semibold text-brand-navy">{rep.pineName}</p>
              <p className="text-xs text-muted">Code: {rep.employeeCode} · {rep.recentCalls > 0 ? `${rep.recentCalls} call${rep.recentCalls === 1 ? "" : "s"} under this code in 90 days` : "no calls under this code in 90 days"}</p>
              {rep.codeLooksLikeName || rep.sameNameMatches.length > 0 ? (
                <div className="mt-2 rounded-lg border border-accent-amber/30 bg-accent-amber-soft/50 px-2.5 py-2 text-[11px] leading-snug text-muted-strong">
                  {rep.codeLooksLikeName ? <p><strong className="text-accent-amber">The code is a name, not a roster code</strong> — this record was probably created by mistake.</p> : null}
                  {rep.sameNameMatches.slice(0, 2).map((match) => (
                    <p key={match.employeeCode} className={rep.codeLooksLikeName ? "mt-1" : undefined}>
                      Same name as <strong>{match.pineName} ({match.employeeCode})</strong>
                      {match.teamLeaderName ? <>, home Team Leader <strong>{match.teamLeaderName}</strong></> : ", who has no home Team Leader either"}.
                    </p>
                  ))}
                  {rep.sameNameMatches.length > 0 ? <p className="mt-1">{rep.recentCalls > 0 ? "Calls still arrive under this code: link it to that Team Leader to keep them attributed." : "Nothing current uses this code: deleting the duplicate is safe."}</p> : null}
                </div>
              ) : null}
              {rep.sameNameMatches.filter((match) => match.teamLeaderId && match.teamLeaderName).slice(0, 1).map((match) => (
                <form key={match.employeeCode} action={resolveEmployeeIdentityAction} className="mt-2">
                  <input type="hidden" name="employeeCode" value={rep.employeeCode} />
                  <input type="hidden" name="teamLeaderId" value={match.teamLeaderId!} />
                  <button
                    type="submit"
                    className={
                      rep.recentCalls > 0
                        ? "rounded-full bg-primary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue"
                        : "rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft"
                    }
                  >
                    Link to {match.teamLeaderName} (same as {match.employeeCode})
                  </button>
                </form>
              ))}
              {rep.candidates.length === 0 && rep.sameNameMatches.length > 0 ? null : rep.candidates.length === 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs text-muted">No active Team Leader assignment yet — nothing to resolve until this rep is assigned on Team Leaders.</p>
                  {isAdmin ? (
                    <Link
                      href={`/admin/team-leaders?filterEmployee=${encodeURIComponent(rep.employeeCode)}#assignments`}
                      className="inline-flex self-start rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-surface-hover"
                    >
                      Assign a Team Leader →
                    </Link>
                  ) : null}
                </div>
              ) : (
                <form action={resolveEmployeeIdentityAction} className="mt-3 flex items-center gap-2">
                  <input type="hidden" name="employeeCode" value={rep.employeeCode} />
                  <select name="teamLeaderId" required defaultValue="" className={`${inputClass} mt-0`}>
                    <option value="" disabled>
                      Choose home Team Leader
                    </option>
                    {rep.candidates.map((c) => (
                      <option key={c.teamLeaderId} value={c.teamLeaderId}>
                        {c.teamLeaderName}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-full bg-primary-blue px-3 py-2 text-xs font-semibold text-white hover:bg-secondary-blue">
                    Save
                  </button>
                </form>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                <form action={toggleEmployeeMasterActiveAction}>
                  <input type="hidden" name="employeeCode" value={rep.employeeCode} />
                  <button type="submit" title="Keeps the record but takes it off this list and out of the roster." className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
                    Deactivate
                  </button>
                </form>
                <form action={deleteEmployeeMasterAction}>
                  <input type="hidden" name="employeeCode" value={rep.employeeCode} />
                  <ConfirmSubmitButton
                    confirmMessage={deleteMessage(rep.pineName, rep.employeeCode, assignmentCountByCode.get(rep.employeeCode) ?? 0)}
                    className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft"
                  >
                    Delete record
                  </ConfirmSubmitButton>
                </form>
              </div>
            </div>
          ))}
        </div>
      </AdminDisclosure> : null}

      {dismissedSuggestions.length > 0 ? <AdminDisclosure
        tone="note"
        title="Dismissed suggestions"
        badge={<AdminBadge>{dismissedSuggestions.length}</AdminBadge>}
        description="Timestamp codes you chose not to add. Restore one to see it as a suggestion again."
        className="xl:col-span-2"
      >
        <ul className="flex max-h-[260px] flex-col divide-y divide-border/60 overflow-y-auto">
          {dismissedSuggestions.map((row) => (
            <li key={row.employeeCode} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium text-foreground">{row.salesRep ?? row.employeeCode}</span>
                <span className="ml-2 text-xs text-muted">
                  {row.employeeCode} · dismissed {row.dismissedAt.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })} by {row.dismissedBy}
                </span>
              </span>
              <form action={restoreRosterSuggestionAction}>
                <input type="hidden" name="employeeCode" value={row.employeeCode} />
                <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">Restore</button>
              </form>
            </li>
          ))}
        </ul>
      </AdminDisclosure> : null}
      </div> : null}

      <AdminCard
        flush
        title={<>{filtersActive ? "Matching roster records" : isAdmin ? "Master roster" : "Your roster"} <AdminBadge>{employees.length}</AdminBadge></>}
        description={isAdmin ? "Filter by ownership or search a rep before opening an amendment." : undefined}
      >
        <form className="grid gap-3 border-b border-border/60 px-5 py-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" action="/admin/employee-master">
          <label className={labelClass}>Find employee<input name="q" defaultValue={employeeQuery} placeholder="Name, SAP name or employee code" className={inputClass} /></label>
          <label className={labelClass}>Principal<select name="principal" defaultValue={selectedPrincipal} className={inputClass}><option value="">All principals</option>{rosterPrincipalOptions.map((principal) => <option key={principal} value={principal}>{principal}</option>)}</select></label>
          {isAdmin ? <label className={labelClass}>Team Leader<select name="teamLeader" defaultValue={selectedTeamLeader} className={inputClass}><option value="">All Team Leaders</option>{teamLeaderOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label> : <div className="hidden xl:block" />}
          <div className="flex items-end gap-2"><button type="submit" className="rounded-full bg-primary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue">Apply filters</button>{filtersActive ? <Link href="/admin/employee-master" className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-primary-blue hover:bg-surface-hover">Clear</Link> : null}</div>
        </form>
        <div className="overflow-x-auto"><table className={adminTable.table}><thead className="bg-background-elevated text-[12px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-2.5 text-left font-medium">Pine sales rep</th><th className="px-4 py-2.5 text-left font-medium">SAP sales rep</th><th className="px-4 py-2.5 text-left font-medium">Absolute principal</th><th className="px-4 py-2.5 text-left font-medium">JPA principals</th><th className="px-4 py-2.5 text-left font-medium">Role</th><th className="px-4 py-2.5 text-left font-medium">Team leader</th><th className="px-4 py-2.5 text-left font-medium">Status</th><th className="px-4 py-2.5 text-right font-medium">Action</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id} className={employee.active ? undefined : "opacity-50"}><td className="border-b border-border/60 px-4 py-2.5">{employee.pineName} <span className="text-muted">({employee.employeeCode})</span></td><td className="border-b border-border/60 px-4 py-2.5">{employee.sapName}</td><td className="border-b border-border/60 px-4 py-2.5 font-medium">{employee.absolutePrincipal}</td><td className="border-b border-border/60 px-4 py-2.5">{employee.contributions.map((row) => row.principal).join(", ") || "—"}</td><td className="border-b border-border/60 px-4 py-2.5">{employee.salesRole}</td><td className="border-b border-border/60 px-4 py-2.5">{isAdmin ? (employee.teamLeaderId ? teamLeaderNameById.get(employee.teamLeaderId) ?? employee.teamLeaderId : <span className="text-accent-amber">Unresolved</span>) : employee.teamLeader ?? "—"}</td><td className="border-b border-border/60 px-4 py-2.5">{employee.active ? <span className="text-accent-green">Active</span> : <span className="text-accent-red">Inactive</span>}</td><td className="border-b border-border/60 px-4 py-2.5 text-right"><div className="inline-flex items-center gap-1"><Link href={`/admin/employee-master?edit=${encodeURIComponent(employee.employeeCode)}`} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">Edit</Link><form action={toggleEmployeeMasterActiveAction}><input type="hidden" name="employeeCode" value={employee.employeeCode} /><button className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">{employee.active ? "Deactivate" : "Activate"}</button></form>{isAdmin ? <form action={deleteEmployeeMasterAction}><input type="hidden" name="employeeCode" value={employee.employeeCode} /><ConfirmSubmitButton confirmMessage={deleteMessage(employee.pineName, employee.employeeCode, assignmentCountByCode.get(employee.employeeCode) ?? 0)} className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft">Delete</ConfirmSubmitButton></form> : null}</div></td></tr>)}{employees.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">No roster records match these filters.</td></tr> : null}</tbody></table></div>
      </AdminCard>
  </AdminPage>;
}
