import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getKnownReps, getKnownPrincipals } from "@/lib/adminReference";
import { validateContributionTotals } from "@/lib/repContribution";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { canEditMonthlyTarget } from "@/lib/targetPermission";
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import { ensureWeeklyTargetGrid, getWeeksInMonth } from "@/lib/weeklyTargets";
import {
  createAssignmentAction,
  uploadRosterCsvAction,
  createReliefAction,
  endReliefAction,
  deleteReliefAction,
} from "./actions";
import { RosterAssignmentsCascade } from "./RosterAssignmentsCascade";
import { RosterHierarchyTree } from "./RosterHierarchyTree";
import { RosterTargetsPanel } from "./RosterTargetsPanel";

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
    renameSupervisor?: string;
    renameHod?: string;
    renameDirector?: string;
    edit?: string;
    teamLeaderId?: string;
    principal?: string;
    filterTeamLeader?: string;
    filterEmployee?: string;
    filterPrincipal?: string;
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
    renameSupervisor,
    renameHod,
    renameDirector,
    edit,
    teamLeaderId: lastTeamLeaderId,
    principal: lastPrincipal,
    filterTeamLeader,
    filterEmployee,
    filterPrincipal,
  } = await searchParams;

  const [teamLeaders, assignments, knownReps, knownPrincipals, supervisors, managers, hods, directors, reliefs] = await Promise.all([
    prisma.teamLeader.findMany({ where: scope ? { id: { in: scope.teamLeaderIds } } : {}, orderBy: { name: "asc" } }),
    prisma.teamLeaderAssignment.findMany({
      where: scope ? { teamLeaderId: { in: scope.teamLeaderIds } } : {},
      orderBy: [{ teamLeaderId: "asc" }, { principal: "asc" }, { employeeName: "asc" }],
    }),
    getKnownReps(),
    getKnownPrincipals(),
    prisma.supervisor.findMany({ orderBy: { name: "asc" } }),
    prisma.manager.findMany({ orderBy: { name: "asc" } }),
    prisma.hod.findMany({ orderBy: { name: "asc" } }),
    prisma.director.findMany({ orderBy: { name: "asc" } }),
    // "Currently active" mirrors lib/teamLeaderScope.ts's getActiveReliefCoverage
    // exactly (revokedAt null, within any start/end window) — both sides scoped
    // to a Supervisor's own group the same way teamLeaders/assignments above are.
    prisma.teamLeaderRelief.findMany({
      where: scope
        ? { coveringTeamLeaderId: { in: scope.teamLeaderIds }, coveredTeamLeaderId: { in: scope.teamLeaderIds } }
        : {},
      orderBy: [{ createdAt: "desc" }],
    }),
  ]);

  const contributionWarnings = validateContributionTotals(assignments);

  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const assignmentsByTeamLeader = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByTeamLeader.get(a.teamLeaderId) ?? [];
    list.push(a);
    assignmentsByTeamLeader.set(a.teamLeaderId, list);
  }

  // Rep-detail drawer data: this session's own scope-filtered assignments
  // already tell us every employeeCode that could be opened, so these two
  // queries stay just as scoped as everything else on this page.
  const drawerEmployeeCodes = Array.from(new Set(assignments.map((a) => a.employeeCode)));
  const [employeeIdentities, repContributions] = await Promise.all([
    prisma.employeeMaster.findMany({
      where: { employeeCode: { in: drawerEmployeeCodes } },
      select: {
        employeeCode: true,
        pineName: true,
        sapName: true,
        absolutePrincipal: true,
        salesRole: true,
        region: true,
        subRegion: true,
        active: true,
        teamLeaderId: true,
        supervisorId: true,
        contributions: { select: { principal: true } },
      },
    }),
    prisma.repContribution.findMany({
      where: { employeeCode: { in: drawerEmployeeCodes } },
      select: { employeeCode: true, principal: true, teamLeaderId: true, quarterRevenue: true, sharePct: true },
    }),
  ]);

  // Targets context for whichever Team Leader x Principal is currently
  // selected in the Assignments cascade — only when both are set, and only
  // for a Team Leader within this session's own scope (teamLeaderNameById is
  // already scope-filtered above, same guarantee the rest of this page relies on).
  let targetsPanelData = null;
  if (filterTeamLeader && filterPrincipal && teamLeaderNameById.has(filterTeamLeader)) {
    const today = new Date();
    const year = String(today.getUTCFullYear());
    const month = CANONICAL_MONTHS[today.getUTCMonth()];
    await ensureWeeklyTargetGrid([{ teamLeaderId: filterTeamLeader, principal: filterPrincipal }]);
    const weeks = getWeeksInMonth(Number(year), CANONICAL_MONTHS.indexOf(month));
    const weekStartDates = weeks.map((w) => w.weekStartDate);
    const [monthlyTarget, sharedAssignments, weeklyRows, canEdit] = await Promise.all([
      prisma.target.findUnique({ where: { year_month_principal: { year, month, principal: filterPrincipal } } }),
      prisma.teamLeaderAssignment.findMany({ where: { principal: filterPrincipal, active: true }, distinct: ["teamLeaderId"], select: { teamLeaderId: true } }),
      prisma.weeklyTarget.findMany({ where: { teamLeaderId: filterTeamLeader, principal: filterPrincipal, weekStartDate: { in: weekStartDates } } }),
      canEditMonthlyTarget(session.user),
    ]);
    const weeklyRowByWeekStart = new Map(weeklyRows.map((r) => [r.weekStartDate.getTime(), r]));
    targetsPanelData = {
      teamLeaderId: filterTeamLeader,
      teamLeaderName: teamLeaderNameById.get(filterTeamLeader) ?? filterTeamLeader,
      principal: filterPrincipal,
      year,
      month,
      monthlyTarget: monthlyTarget ? { valueTarget: monthlyTarget.valueTarget, volumeTarget: monthlyTarget.volumeTarget } : null,
      sharedWithCount: sharedAssignments.length,
      canEditMonthlyTarget: canEdit,
      weeklyRows: weeks.map((w) => {
        const row = weeklyRowByWeekStart.get(w.weekStartDate.getTime());
        return { weekLabel: w.weekLabel, id: row?.id ?? null, targetValue: row?.targetValue ?? 0 };
      }),
    };
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Team Leaders</h1>
        <p className="mt-1 text-sm text-white/70">
          The roster is the editable rep/principal allocation and activity source for executive target attribution. Active Primary assignments and Contribution % determine how the full-month mission is allocated to Team Leaders and sales reps.
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold text-primary-blue">Upload Roster (CSV)</h2>
            <a
              href="/api/team-leaders/export-roster"
              className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft"
            >
              Download current roster (CSV)
            </a>
          </div>
          <p className="mt-1 text-[13px] text-muted">
            Expects the Target_Management_System.xlsm workbook&apos;s own Roster sheet, exported as CSV (a single header row —
            Employee Code, Employee (Sales Edge Name), SAP Name, Channel, Team Leader, Principal, * Contribution %, Active
            (Y/N), and the rest of the reference columns). Every row is upserted; nothing is auto-deactivated. The download
            above produces the same 18-column shape this upload expects (Sales Supervisor/Manager format), pre-filled with
            every current assignment — edit Active, Primary/Secondary role, Principal, or Contribution % here to update allocation and re-upload in bulk.
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
          <RosterHierarchyTree
            teamLeaders={teamLeaders.map((tl) => ({
              id: tl.id,
              name: tl.name,
              supervisorId: tl.supervisorId,
              assignmentCount: (assignmentsByTeamLeader.get(tl.id) ?? []).length,
              activeAssignmentCount: (assignmentsByTeamLeader.get(tl.id) ?? []).filter((assignment) => assignment.active).length,
              inactiveAssignmentCount: (assignmentsByTeamLeader.get(tl.id) ?? []).filter((assignment) => !assignment.active).length,
              visiblePages: tl.visiblePages,
              canEditTargets: tl.canEditTargets,
            }))}
            supervisors={supervisors.map((s) => ({ id: s.id, name: s.name, managerId: s.managerId, visiblePages: s.visiblePages, canEditTargets: s.canEditTargets }))}
            managers={managers.map((m) => ({ id: m.id, name: m.name, hodId: m.hodId }))}
            hods={hods.map((h) => ({ id: h.id, name: h.name, directorId: h.directorId }))}
            directors={directors.map((d) => ({ id: d.id, name: d.name }))}
            renamingTeamLeaderId={rename}
            renamingSupervisorId={renameSupervisor}
            renamingHodId={renameHod}
            renamingDirectorId={renameDirector}
            inputClass={inputClass}
            labelClass={labelClass}
          />
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Relief / Holding Fort</h2>
          <p className="mt-1 text-[13px] text-muted">
            Grant one Team Leader temporary access to another&apos;s own scope — principals, reps, coverage —
            while relieving or holding fort for them (e.g. annual leave). This is peer-to-peer, separate from
            the permanent &quot;Reports to&quot; reporting line above. Access takes effect immediately and clears
            automatically once ended or an optional end date passes.
          </p>
          <form action={createReliefAction} className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Covering (e.g. Benson)</label>
              <select name="coveringTeamLeaderId" required defaultValue="" className={inputClass}>
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
              <label className={labelClass}>Covered (e.g. Calvince)</label>
              <select name="coveredTeamLeaderId" required defaultValue="" className={inputClass}>
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
              <label className={labelClass}>Start date (optional — default now)</label>
              <input name="startDate" type="date" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>End date (optional — indefinite)</label>
              <input name="endDate" type="date" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-3">
              <label className={labelClass}>Notes (optional)</label>
              <input name="notes" placeholder="e.g. Calvince on annual leave" className={inputClass} />
            </div>
            <div>
              <button
                type="submit"
                className="w-full rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Start relief
              </button>
            </div>
          </form>

          <div className="mt-5 flex flex-col gap-2">
            {reliefs.map((r) => {
              const now = new Date();
              const isActive = !r.revokedAt && r.startDate <= now && (!r.endDate || r.endDate >= now);
              return (
                <div key={r.id} className={`flex items-center justify-between gap-3 flex-wrap rounded-xl bg-background-elevated px-4 py-2.5 ${isActive ? "" : "opacity-50"}`}>
                  <span className="text-sm font-medium text-foreground">
                    {teamLeaderNameById.get(r.coveringTeamLeaderId) ?? "—"} covers {teamLeaderNameById.get(r.coveredTeamLeaderId) ?? "—"}
                    <span className="ml-2 text-[13px] text-muted">
                      {r.startDate.toISOString().slice(0, 10)}
                      {r.endDate ? ` – ${r.endDate.toISOString().slice(0, 10)}` : " – indefinite"}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </span>
                    <span className={`ml-2 text-[13px] ${isActive ? "text-accent-green" : "text-accent-red"}`}>
                      {r.revokedAt ? "Ended" : isActive ? "Active" : r.startDate > now ? "Scheduled" : "Expired"}
                    </span>
                  </span>
                  <div className="flex items-center gap-3 flex-wrap">
                    {isActive ? (
                      <form action={endReliefAction} className="inline">
                        <input type="hidden" name="reliefId" value={r.id} />
                        <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-amber hover:bg-accent-amber-soft transition-colors duration-300">
                          End now
                        </button>
                      </form>
                    ) : null}
                    <form action={deleteReliefAction} className="inline">
                      <input type="hidden" name="reliefId" value={r.id} />
                      <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                        Remove
                      </button>
                    </form>
                  </div>
                </div>
              );
            })}
            {reliefs.length === 0 ? <p className="text-sm text-muted">No relief assignments yet.</p> : null}
          </div>
        </div>

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Assign a rep to a Team Leader × Principal</h2>
          <p className="mt-1 text-[13px] text-muted">
            Saving creates an active visibility assignment immediately. A rep can be shared across multiple Team Leaders and principals; each Team Leader has their own visibility assignment.
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
                Assign &amp; make visible
              </button>
            </div>
          </form>
          <p className="mt-2 text-[13px] text-muted">
            Contribution % is the admin-declared share of this rep&apos;s Team Leader&apos;s Weekly Target — leave blank to keep using the
            computed share (each rep&apos;s actual trailing-revenue share) until you&apos;re ready to declare one. Declared %s should sum to
            100% across a Principal&apos;s active reps. Saving an existing inactive assignment reactivates it; globally inactive Employee Roster reps must be activated there first.
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

        {targetsPanelData ? <RosterTargetsPanel data={targetsPanelData} inputClass={inputClass} /> : null}

        <RosterAssignmentsCascade
          assignments={assignments.map((a) => ({
            id: a.id,
            teamLeaderId: a.teamLeaderId,
            employeeCode: a.employeeCode,
            employeeName: a.employeeName,
            principal: a.principal,
            channel: a.channel,
            contributionPct: a.contributionPct,
            salesRole: a.salesRole,
            active: a.active,
          }))}
          teamLeaders={teamLeaders.map((tl) => ({ id: tl.id, name: tl.name, supervisorId: tl.supervisorId }))}
          supervisors={supervisors.map((s) => ({ id: s.id, name: s.name }))}
          knownPrincipals={knownPrincipals}
          employeeIdentities={employeeIdentities.map((e) => ({ ...e, contributionPrincipals: e.contributions.map((c) => c.principal) }))}
          repContributions={repContributions}
          initialTeamLeaderId={filterTeamLeader ?? ""}
          initialPrincipal={filterPrincipal ?? ""}
          initialEmployeeSearch={filterEmployee ?? ""}
          editingId={edit}
          inputClass={inputClass}
          labelClass={labelClass}
        />
      </div>
    </div>
  );
}
