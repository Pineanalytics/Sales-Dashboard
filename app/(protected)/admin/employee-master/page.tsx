import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownPrincipals, getKnownSapSalesReps } from "@/lib/adminReference";
import { getTimestampRosterSuggestions } from "@/lib/employeeRosterSuggestions";
import { saveEmployeeMasterAction, toggleEmployeeMasterActiveAction } from "./actions";

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
    isAdmin ? prisma.teamLeader.findMany({ orderBy: { name: "asc" }, select: { name: true } }) : Promise.resolve([]),
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

  const [employees, suggestions, knownPrincipals, sapSalesRepOptions] = await Promise.all([
    prisma.employeeMaster.findMany({
      where: rosterWhere,
      include: { contributions: { orderBy: { principal: "asc" } } },
      orderBy: [{ active: "desc" }, { pineName: "asc" }],
    }),
    getTimestampRosterSuggestions(isAdmin ? undefined : ownPrincipals),
    getKnownPrincipals(),
    getKnownSapSalesReps(),
  ]);

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

  return <div className="min-h-screen bg-background">
    <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 py-6 shadow-[0_2px_10px_rgba(11,61,53,0.25)] md:px-8 md:py-7">
      <Link href={isAdmin ? "/admin" : "/dashboard"} className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-leaf">← {isAdmin ? "Back to Admin" : "Back to dashboard"}</Link>
      <h1 className="mt-3 text-[26px] font-bold leading-tight text-white md:text-[34px]">Employee Roster</h1>
      <p className="mt-1 text-sm text-white/70">Maintain Pine and SAP names, absolute principal, sales role, and team ownership. Timestamp suggestions always need a reviewer&apos;s confirmation.</p>
    </div>

    <div className="mx-auto flex max-w-[1500px] flex-col gap-5 p-4 md:p-8">
      {params.success ? <div className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{params.success}</div> : null}
      {params.error ? <div className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{params.error}</div> : null}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-secondary-blue">Roster control</p>
            <h2 className="mt-1 text-lg font-bold text-brand-navy">{filtersActive ? `${employees.length} matching roster record${employees.length === 1 ? "" : "s"}` : isAdmin ? `${employees.length} employees in the master roster` : `${employees.length} rep${employees.length === 1 ? "" : "s"} in your roster`}</h2>
            <p className="mt-1 text-sm text-muted">{isAdmin ? "Filter by ownership or search a rep before opening an amendment." : `You can add and amend reps assigned to ${teamLeader!.name}.`}</p>
          </div>
          <Link href="/admin/employee-master?add=new" className="rounded-full bg-primary-blue px-4 py-2 text-xs font-semibold text-white hover:bg-secondary-blue">Add employee</Link>
        </div>
      </section>

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

      {suggestions.length > 0 ? <section className="rounded-2xl border border-accent-amber/30 bg-surface p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-amber">Timestamp roster suggestions</p><h2 className="mt-1 text-lg font-bold text-brand-navy">New reps seen in productive calls</h2><p className="mt-1 text-sm text-muted">The suggested principal is the most frequent sales cost centre in the last 90 days. It is not applied until you add the rep.</p></div>
          <span className="rounded-full bg-accent-amber-soft px-2.5 py-1 text-xs font-semibold text-accent-amber">{suggestions.length} to review</span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{suggestions.map((suggestion) => <div key={suggestion.employeeCode} className="rounded-xl border border-border bg-background-elevated/35 p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-brand-navy">{suggestion.salesRep}</p><p className="text-xs text-muted">{suggestion.employeeCode}</p></div><span className="rounded-full bg-accent-green-soft px-2 py-0.5 text-[10px] font-semibold text-accent-green">{suggestion.productiveCalls} sales</span></div><p className="mt-3 text-xs text-muted">Suggested absolute principal</p><p className="text-sm font-semibold text-secondary-blue">{suggestion.suggestedPrincipal}</p><p className="mt-1 text-[11px] text-muted">Last call {suggestion.latestCallDate.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}</p><Link href={`/admin/employee-master?add=${encodeURIComponent(suggestion.employeeCode)}`} className="mt-3 inline-flex rounded-full border border-secondary-blue/30 bg-surface px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-surface-hover">Review and add</Link></div>)}</div>
      </section> : null}

      <section className="rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" action="/admin/employee-master">
          <label className={labelClass}>Find employee<input name="q" defaultValue={employeeQuery} placeholder="Name, SAP name or employee code" className={inputClass} /></label>
          <label className={labelClass}>Principal<select name="principal" defaultValue={selectedPrincipal} className={inputClass}><option value="">All principals</option>{rosterPrincipalOptions.map((principal) => <option key={principal} value={principal}>{principal}</option>)}</select></label>
          {isAdmin ? <label className={labelClass}>Team Leader<select name="teamLeader" defaultValue={selectedTeamLeader} className={inputClass}><option value="">All Team Leaders</option>{teamLeaderOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label> : <div className="hidden xl:block" />}
          <div className="flex items-end gap-2"><button type="submit" className="rounded-full bg-primary-blue px-4 py-2.5 text-sm font-semibold text-white hover:bg-secondary-blue">Apply filters</button>{filtersActive ? <Link href="/admin/employee-master" className="rounded-full border border-border px-4 py-2.5 text-sm font-semibold text-primary-blue hover:bg-surface-hover">Clear</Link> : null}</div>
        </form>
      </section>

      <section className="overflow-hidden rounded-2xl bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="overflow-x-auto"><table className="w-full border-collapse text-sm"><thead className="bg-background-elevated text-[12px] uppercase tracking-wide text-muted"><tr><th className="px-4 py-3 text-left font-medium">Pine sales rep</th><th className="px-4 py-3 text-left font-medium">SAP sales rep</th><th className="px-4 py-3 text-left font-medium">Absolute principal</th><th className="px-4 py-3 text-left font-medium">JPA principals</th><th className="px-4 py-3 text-left font-medium">Role</th><th className="px-4 py-3 text-left font-medium">Team leader</th><th className="px-4 py-3 text-left font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Action</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id} className={employee.active ? undefined : "opacity-50"}><td className="border-b border-border/60 px-4 py-3">{employee.pineName} <span className="text-muted">({employee.employeeCode})</span></td><td className="border-b border-border/60 px-4 py-3">{employee.sapName}</td><td className="border-b border-border/60 px-4 py-3 font-medium">{employee.absolutePrincipal}</td><td className="border-b border-border/60 px-4 py-3">{employee.contributions.map((row) => row.principal).join(", ") || "—"}</td><td className="border-b border-border/60 px-4 py-3">{employee.salesRole}</td><td className="border-b border-border/60 px-4 py-3">{employee.teamLeader ?? "—"}</td><td className="border-b border-border/60 px-4 py-3">{employee.active ? <span className="text-accent-green">Active</span> : <span className="text-accent-red">Inactive</span>}</td><td className="border-b border-border/60 px-4 py-3 text-right"><div className="inline-flex items-center gap-1"><Link href={`/admin/employee-master?edit=${encodeURIComponent(employee.employeeCode)}`} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">Edit</Link><form action={toggleEmployeeMasterActiveAction}><input type="hidden" name="employeeCode" value={employee.employeeCode} /><button className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">{employee.active ? "Deactivate" : "Activate"}</button></form></div></td></tr>)}{employees.length === 0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">No roster records match these filters.</td></tr> : null}</tbody></table></div>
      </section>
    </div>
  </div>;
}
