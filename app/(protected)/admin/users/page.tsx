import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ANNOUNCEMENT_TEMPLATE_KEY, DEFAULT_ANNOUNCEMENT_SUBJECT, DEFAULT_ANNOUNCEMENT_BODY } from "@/lib/email";
import { getKnownPrincipals } from "@/lib/adminReference";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { UserDirectory, type DirectoryUser, type TeamLeaderOption, type SupervisorOption } from "@/components/admin/UserDirectory";
import { NewUserForm } from "@/components/admin/NewUserForm";
import {
  approveUserAction,
  rejectUserAction,
  approveRoleConfirmationAction,
  dismissRoleConfirmationAction,
  saveAnnouncementTemplateAction,
  resetAnnouncementTemplateAction,
  sendNewModulesAnnouncementAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; open?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, open } = await searchParams;
  const allUsers = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const pending = allUsers.filter((u) => u.status === "PENDING");
  const approved = allUsers.filter((u) => u.status === "APPROVED");
  const roleConfirmations = approved.filter((u) => u.proposedRole !== null);
  const teamLeaders = await prisma.teamLeader.findMany({ orderBy: { name: "asc" } });
  const supervisors = await prisma.supervisor.findMany({ orderBy: { name: "asc" } });
  const knownPrincipals = await getKnownPrincipals();
  const announcementTemplate = await prisma.emailTemplate.findUnique({ where: { key: ANNOUNCEMENT_TEMPLATE_KEY } });
  const announcementSubject = announcementTemplate?.subject ?? DEFAULT_ANNOUNCEMENT_SUBJECT;
  const announcementBody = announcementTemplate?.body ?? DEFAULT_ANNOUNCEMENT_BODY;

  // One batch query for every Team Leader's principal/rep summary (not N+1 per row) —
  // read-only surfacing of TeamLeaderAssignment data that's already fully editable on
  // /admin/team-leaders; this page never mutates it.
  const activeAssignments = await prisma.teamLeaderAssignment.findMany({
    where: { active: true },
    select: { teamLeaderId: true, principal: true, employeeCode: true },
  });
  const principalSummaryByTeamLeader = new Map<string, { principal: string; repCount: number }[]>();
  for (const a of activeAssignments) {
    const byPrincipal = principalSummaryByTeamLeader.get(a.teamLeaderId) ?? [];
    const existing = byPrincipal.find((p) => p.principal === a.principal);
    if (existing) existing.repCount += 1;
    else byPrincipal.push({ principal: a.principal, repCount: 1 });
    principalSummaryByTeamLeader.set(a.teamLeaderId, byPrincipal);
  }
  const teamLeaderIdsBySupervisor = new Map<string, Set<string>>();
  const supervisorAssignments = await prisma.teamLeaderAssignment.findMany({
    where: { active: true, supervisorId: { not: null } },
    select: { supervisorId: true, teamLeaderId: true },
  });
  for (const a of supervisorAssignments) {
    if (!a.supervisorId) continue;
    const set = teamLeaderIdsBySupervisor.get(a.supervisorId) ?? new Set<string>();
    set.add(a.teamLeaderId);
    teamLeaderIdsBySupervisor.set(a.supervisorId, set);
  }

  // Lets a TL/Supervisor dropdown option show the registered login already
  // matched to that roster entry by email (set on /admin/team-leaders, or by
  // the Sales Leadership CSV importer), and lets an unlinked user's own
  // dropdown default to the entry matching their own email — see
  // prisma/schema.prisma's TeamLeader.email/Supervisor.email comment.
  const userByEmail = new Map(allUsers.map((u) => [u.email.toLowerCase(), u]));
  function teamLeaderOptionLabel(tl: { name: string; email: string | null }): string {
    const matched = tl.email ? userByEmail.get(tl.email.toLowerCase()) : undefined;
    return matched ? `${tl.name} — registered as "${matched.name || matched.email}"` : tl.name;
  }
  function supervisorOptionLabel(s: { name: string; email: string | null }): string {
    const matched = s.email ? userByEmail.get(s.email.toLowerCase()) : undefined;
    return matched ? `${s.name} — registered as "${matched.name || matched.email}"` : s.name;
  }
  const teamLeaderByEmail = new Map(teamLeaders.filter((tl) => tl.email).map((tl) => [tl.email!.toLowerCase(), tl.id]));
  const supervisorByEmail = new Map(supervisors.filter((s) => s.email).map((s) => [s.email!.toLowerCase(), s.id]));

  // For the per-user "Employee Code link" editor below — lets the admin see
  // whose roster entry a code resolves to before/after saving it.
  const employeeByCode = new Map(
    (await prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true } })).map((e) => [e.employeeCode, e])
  );

  // Flat, pre-labelled option lists for UserDirectory's (client-side) Team Leader/
  // Supervisor pickers — computed here since teamLeaderOptionLabel/supervisorOptionLabel
  // close over server-only data (userByEmail); the per-row "is this a real team leader"
  // filter itself is a pure function (lib/teamLeaderKind.ts) UserDirectory applies client-side.
  const teamLeaderOptions: TeamLeaderOption[] = teamLeaders.map((tl) => ({ id: tl.id, label: teamLeaderOptionLabel(tl), kind: tl.kind }));
  const supervisorOptions: SupervisorOption[] = supervisors.map((s) => ({ id: s.id, label: supervisorOptionLabel(s) }));

  const directoryUsers: DirectoryUser[] = approved.map((u) => {
    const employeeMatch = u.employeeCode ? (employeeByCode.get(u.employeeCode) ?? null) : null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAtLabel: u.createdAt.toLocaleDateString(),
      teamLeaderId: u.teamLeaderId,
      supervisorId: u.supervisorId,
      employeeCode: u.employeeCode,
      allowedPages: u.allowedPages,
      allowedPrincipals: u.allowedPrincipals,
      suggestedTeamLeaderId: teamLeaderByEmail.get(u.email.toLowerCase()) ?? null,
      suggestedSupervisorId: supervisorByEmail.get(u.email.toLowerCase()) ?? null,
      employeeMatch: employeeMatch ? { pineName: employeeMatch.pineName, sapName: employeeMatch.sapName } : null,
      teamLeaderSummary: u.teamLeaderId ? (principalSummaryByTeamLeader.get(u.teamLeaderId) ?? []) : null,
      supervisorGroupSize: u.supervisorId ? (teamLeaderIdsBySupervisor.get(u.supervisorId)?.size ?? 0) : null,
    };
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Manage Users</h1>
        <p className="mt-1 text-sm text-white/70">Approve registration requests and control roles, report access and passwords.</p>
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

        {pending.length > 0 ? (
          <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold text-primary-blue">Pending Requests ({pending.length})</h2>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Name</th>
                    <th className="px-6 py-3 text-left font-medium">Email</th>
                    <th className="px-6 py-3 text-left font-medium">Role requested</th>
                    <th className="px-6 py-3 text-left font-medium">Requested on</th>
                    <th className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((u) => (
                    <tr key={u.id}>
                      <td className="px-6 py-3 border-b border-border/60">{u.name || "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60">{u.email}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-muted-strong">
                        {u.requestedRole ? u.requestedRole.replace("_", " ") : "— (pre-dates role requests)"}
                      </td>
                      <td className="px-6 py-3 border-b border-border/60 text-muted">{u.createdAt.toLocaleDateString()}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">
                        <div className="inline-flex items-center gap-2">
                          <form action={approveUserAction} className="inline">
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-3 py-1.5 text-xs font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
                            >
                              Approve
                            </button>
                          </form>
                          <form action={rejectUserAction} className="inline">
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300"
                            >
                              Reject
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {roleConfirmations.length > 0 ? (
          <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            <div className="p-6 pb-0">
              <h2 className="text-lg font-semibold text-primary-blue">Role confirmations ({roleConfirmations.length})</h2>
              <p className="mt-1 text-sm text-muted-strong">
                Submitted from the one-time role-confirmation prompt. Approve to apply the role (and auto-link a matching Team
                Leader/Supervisor by email, if any) — Dismiss leaves their current role unchanged.
              </p>
            </div>
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-6 py-3 text-left font-medium">Name</th>
                    <th className="px-6 py-3 text-left font-medium">Email</th>
                    <th className="px-6 py-3 text-left font-medium">Current role</th>
                    <th className="px-6 py-3 text-left font-medium">Confirmed as</th>
                    <th className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roleConfirmations.map((u) => (
                    <tr key={u.id}>
                      <td className="px-6 py-3 border-b border-border/60">{u.name || "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60">{u.email}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-muted">{u.role.replace("_", " ")}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-muted-strong">
                        {u.proposedRole!.replace("_", " ")}
                        {u.proposedRole === u.role ? <span className="ml-1.5 text-xs text-muted">(no change)</span> : null}
                      </td>
                      <td className="px-6 py-3 border-b border-border/60 text-right">
                        <div className="inline-flex items-center gap-2">
                          <form action={approveRoleConfirmationAction} className="inline">
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-3 py-1.5 text-xs font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
                            >
                              Approve
                            </button>
                          </form>
                          <form action={dismissRoleConfirmationAction} className="inline">
                            <input type="hidden" name="userId" value={u.id} />
                            <button
                              type="submit"
                              className="rounded-full px-3 py-1.5 text-xs font-medium text-muted-strong hover:bg-background-elevated transition-colors duration-300"
                            >
                              Dismiss
                            </button>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Add a new user</h2>
          <NewUserForm
            teamLeaders={teamLeaders.map((tl) => ({ id: tl.id, name: tl.name, email: tl.email }))}
            supervisors={supervisors.map((s) => ({ id: s.id, name: s.name, email: s.email }))}
          />
          {teamLeaders.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              No Team Leaders exist yet — add them on the <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">Team Leaders</Link> page first.
            </p>
          ) : null}
          {supervisors.length === 0 ? (
            <p className="mt-1 text-xs text-muted">
              No Sales Supervisors exist yet — they&apos;re created automatically the first time a Roster CSV with a
              &quot;Sales Supervisor&quot; column is imported on <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">Team Leaders</Link>.
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Announcement email</h2>
          <p className="mt-1 text-sm text-muted-strong">
            Edit the wording below, then save it, send it to all {approved.length} approved user(s), or reset back to the original. The greeting, sign-in
            link, and system-generated disclaimer are added automatically — no need to include them.
          </p>
          <form action={saveAnnouncementTemplateAction} className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="subject" className="text-[13px] font-medium text-muted-strong">
                Subject
              </label>
              <input
                id="subject"
                name="subject"
                type="text"
                required
                defaultValue={announcementSubject}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="body" className="text-[13px] font-medium text-muted-strong">
                Body
              </label>
              <textarea
                id="body"
                name="body"
                required
                rows={10}
                defaultValue={announcementBody}
                className="rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-foreground outline-none focus:border-secondary-blue font-mono"
              />
              <span className="text-xs text-muted">Blank lines start a new paragraph. Lines starting with &quot;- &quot; render as a bullet list.</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-primary-blue transition-colors duration-300 hover:bg-accent-blue-soft"
              >
                Save changes
              </button>
              <ConfirmSubmitButton
                formAction={sendNewModulesAnnouncementAction}
                confirmMessage={`Save this wording and send it to all ${approved.length} approved user(s)?`}
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Save &amp; send to all users
              </ConfirmSubmitButton>
              <ConfirmSubmitButton
                formAction={resetAnnouncementTemplateAction}
                confirmMessage="Discard your edits and reset the announcement to its original wording?"
                className="rounded-full px-4 py-2 text-sm font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300"
              >
                Reset to original
              </ConfirmSubmitButton>
            </div>
          </form>
        </div>

        <UserDirectory
          users={directoryUsers}
          teamLeaders={teamLeaderOptions}
          supervisors={supervisorOptions}
          knownPrincipals={knownPrincipals}
          currentUserId={session.user.id}
          forceOpenUserId={open ?? null}
        />
      </div>
    </div>
  );
}
