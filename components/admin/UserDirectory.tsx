"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { isRealTeamLeader } from "@/lib/teamLeaderKind";
import { REPORT_MODULES, canAccessModule, isPageKey, type PageKey } from "@/lib/pageAccess";
import {
  ALL_ROLES,
  PRINCIPAL_SCOPED_ROLES,
  ROLE_DEFAULT_PAGES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  isRole,
  roleLabel,
  roleUsesSupervisorLink,
  roleUsesTeamLeaderLink,
  type Role,
} from "@/lib/roles";
import { ModuleAccessPicker } from "@/components/admin/ModuleAccessPicker";
import { PrincipalPicker } from "@/components/admin/PrincipalPicker";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import { deleteUserAction, resetPasswordAction, updateUserAccessAction } from "@/app/(protected)/admin/users/actions";

export interface TeamLeaderOption {
  id: string;
  name: string;
  /** The name plus the registered login already matched to it by email, if any. */
  label: string;
  kind: string | null;
}

export interface SupervisorOption {
  id: string;
  name: string;
  label: string;
}

export interface DirectoryUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAtLabel: string;
  teamLeaderId: string | null;
  supervisorId: string | null;
  employeeCode: string | null;
  allowedPages: string[];
  allowedPrincipals: string[];
  suggestedTeamLeaderId: string | null;
  suggestedSupervisorId: string | null;
  employeeMatch: { pineName: string; sapName: string } | null;
  /** null when no Team Leader is linked; [] when linked but assigned to no principal yet. */
  teamLeaderSummary: { principal: string; repCount: number }[] | null;
  /** null when no Supervisor is linked. */
  supervisorGroupSize: number | null;
  /** A Team Leader / Supervisor whose roster row sets visiblePages, which replaces this login's own report ticks (auth.ts). */
  rosterPagesOverride: boolean;
  /** Principals the linked employee code is actively assigned to. */
  ownPrincipals: string[];
}

const ROLE_TONE: Record<Role, string> = {
  ADMIN: "bg-accent-purple-soft text-accent-purple",
  VIEWER: "bg-accent-grey-soft text-accent-grey",
  HOD: "bg-accent-blue-soft text-accent-blue",
  DIRECTOR: "bg-accent-blue-soft text-accent-blue",
  SUPERVISOR: "bg-accent-blue-soft text-accent-blue",
  TEAM_LEADER: "bg-accent-blue-soft text-accent-blue",
  SALES_REP: "bg-accent-green-soft text-accent-green",
  SALES_ADMIN: "bg-accent-amber-soft text-accent-amber",
  FINANCE_MANAGER: "bg-accent-amber-soft text-accent-amber",
  ACCOUNTANT: "bg-accent-amber-soft text-accent-amber",
  LOGISTICS_MANAGER: "bg-accent-amber-soft text-accent-amber",
  STORES_MANAGER: "bg-accent-amber-soft text-accent-amber",
};

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1fr)_7rem] md:items-center md:gap-4";
const fieldLabel = "text-[11px] font-semibold uppercase tracking-wide text-muted";
const inputClass = "w-full rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-secondary-blue";

function modulesOpenFor(user: DirectoryUser): number {
  return REPORT_MODULES.filter((module) => canAccessModule(module, user.role, user.allowedPages)).length;
}

function issuesOf(user: DirectoryUser): string[] {
  const issues: string[] = [];
  if (roleUsesTeamLeaderLink(user.role) && !user.teamLeaderId) issues.push("No Team Leader link");
  if (roleUsesSupervisorLink(user.role) && !user.supervisorId) issues.push("No Sales Supervisor link");
  if (user.employeeCode && !user.employeeMatch) issues.push(`Code ${user.employeeCode} not on the roster`);
  if (user.role === "SALES_REP" && !user.employeeCode) issues.push(modulesOpenFor(user) === 0 ? "Sees nothing yet" : "No employee code");
  return issues;
}

function RoleBadge({ role }: { role: string }) {
  const tone = isRole(role) ? ROLE_TONE[role] : ROLE_TONE.VIEWER;
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}>{roleLabel(role)}</span>;
}

/** The Users list: a full-width, filterable table with one-line access summaries, each row opening an inline editor that saves
 *  the whole profile in one go. Open rows are React state seeded from forceOpenUserId (echoed back by every per-user action's
 *  redirect, see actions.ts) rather than a native <details>, whose `open` doesn't survive a server action's redirect here — so
 *  the row just saved stays open and in place. */
export function UserDirectory({
  users,
  teamLeaders,
  supervisors,
  knownPrincipals,
  currentUserId,
  forceOpenUserId,
}: {
  users: DirectoryUser[];
  teamLeaders: TeamLeaderOption[];
  supervisors: SupervisorOption[];
  knownPrincipals: string[];
  currentUserId: string;
  forceOpenUserId: string | null;
}) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(forceOpenUserId ? [forceOpenUserId] : []));
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const teamLeaderName = useMemo(() => new Map(teamLeaders.map((tl) => [tl.id, tl.name])), [teamLeaders]);
  const supervisorName = useMemo(() => new Map(supervisors.map((s) => [s.id, s.name])), [supervisors]);
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const user of users) counts.set(user.role, (counts.get(user.role) ?? 0) + 1);
    return counts;
  }, [users]);
  const attentionCount = useMemo(() => users.filter((user) => issuesOf(user).length > 0).length, [users]);

  const normalizedQuery = query.trim().toLowerCase();
  const filterModule = REPORT_MODULES.find((module) => module.id === moduleFilter) ?? null;
  const visibleUsers = users.filter((user) => {
    if (normalizedQuery && !`${user.name ?? ""} ${user.email} ${user.employeeCode ?? ""}`.toLowerCase().includes(normalizedQuery)) return false;
    if (roleFilter && user.role !== roleFilter) return false;
    if (filterModule && !canAccessModule(filterModule, user.role, user.allowedPages)) return false;
    if (attentionOnly && issuesOf(user).length === 0) return false;
    return true;
  });
  const filtering = Boolean(normalizedQuery || roleFilter || moduleFilter || attentionOnly);

  function toggle(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters() {
    setQuery("");
    setRoleFilter("");
    setModuleFilter("");
    setAttentionOnly(false);
  }

  const chip = (active: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
      active ? "border-primary-blue bg-primary-blue text-white" : "border-border bg-surface text-muted-strong hover:border-secondary-blue hover:text-primary-blue"
    }`;

  return (
    // No overflow-hidden on this section: it would become the sticky filter bar's scroll container and stop it sticking.
    <section id="user-directory" className="rounded-2xl bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <div className="sticky top-[7.5rem] z-20 flex flex-col gap-3 rounded-t-2xl border-b border-border/70 bg-surface/95 px-4 py-4 backdrop-blur md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-primary-blue">Users</h2>
          <span className="text-xs font-medium text-muted-strong">{filtering ? `${visibleUsers.length} of ${users.length}` : users.length}</span>
          <div className="ml-auto flex w-full flex-wrap gap-2 sm:w-auto">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, email or employee code…"
              aria-label="Search users"
              className="w-full rounded-full border border-border bg-background px-4 py-1.5 text-sm outline-none placeholder:text-muted focus:border-secondary-blue sm:w-72"
            />
            <select
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
              aria-label="Filter by module access"
              className="min-w-0 flex-1 rounded-full border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-secondary-blue sm:flex-none"
            >
              <option value="">Any module</option>
              {REPORT_MODULES.map((module) => (
                <option key={module.id} value={module.id}>
                  Can open {module.label}
                </option>
              ))}
            </select>
            {filtering ? (
              <button type="button" onClick={clearFilters} className="rounded-full px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by role">
          <button type="button" className={chip(!roleFilter)} aria-pressed={!roleFilter} onClick={() => setRoleFilter("")}>
            All roles <span className="opacity-70">{users.length}</span>
          </button>
          {ALL_ROLES.filter((role) => (roleCounts.get(role) ?? 0) > 0 || roleFilter === role).map((role) => (
            <button key={role} type="button" className={chip(roleFilter === role)} aria-pressed={roleFilter === role} onClick={() => setRoleFilter(roleFilter === role ? "" : role)}>
              {ROLE_LABELS[role]} <span className="opacity-70">{roleCounts.get(role) ?? 0}</span>
            </button>
          ))}
          {attentionCount > 0 || attentionOnly ? (
            <button type="button" className={`${chip(attentionOnly)} ${attentionOnly ? "" : "border-accent-amber/50 text-accent-amber"}`} aria-pressed={attentionOnly} onClick={() => setAttentionOnly(!attentionOnly)}>
              Needs attention <span className="opacity-70">{attentionCount}</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className={`hidden border-b border-border/70 bg-background-elevated px-6 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted ${ROW_GRID}`}>
        <span>User</span>
        <span>Role</span>
        <span>Links</span>
        <span>Reports</span>
        <span>Principals</span>
        <span />
      </div>

      <div className="flex flex-col overflow-hidden rounded-b-2xl">
        {visibleUsers.length === 0 ? <p className="px-6 py-8 text-center text-sm text-muted">No users match these filters.</p> : null}
        {visibleUsers.map((user) => {
          const isOpen = openIds.has(user.id);
          const issues = issuesOf(user);
          return (
            <div key={user.id} id={`user-${user.id}`} className={`scroll-mt-60 border-b border-border/60 last:border-b-0 ${isOpen ? "bg-background-elevated/40" : ""}`}>
              <button
                type="button"
                onClick={() => toggle(user.id)}
                aria-expanded={isOpen}
                className={`flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-background-elevated md:px-6 ${ROW_GRID}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{user.name || user.email}</span>
                  <span className="block truncate text-xs text-muted">
                    {user.email} · joined {user.createdAtLabel}
                  </span>
                </span>
                <span>
                  <RoleBadge role={user.role} />
                </span>
                <span className="flex min-w-0 flex-wrap gap-1">
                  {roleUsesTeamLeaderLink(user.role) && user.teamLeaderId ? <LinkChip>TL · {teamLeaderName.get(user.teamLeaderId) ?? "?"}</LinkChip> : null}
                  {roleUsesSupervisorLink(user.role) && user.supervisorId ? <LinkChip>Sup · {supervisorName.get(user.supervisorId) ?? "?"}</LinkChip> : null}
                  {user.employeeCode ? <LinkChip>Emp {user.employeeCode}</LinkChip> : null}
                  {issues.map((issue) => (
                    <span key={issue} className="rounded-full bg-accent-amber-soft px-2 py-0.5 text-[11px] font-medium text-accent-amber">
                      {issue}
                    </span>
                  ))}
                  {!issues.length && !user.employeeCode && !(roleUsesTeamLeaderLink(user.role) && user.teamLeaderId) && !(roleUsesSupervisorLink(user.role) && user.supervisorId) ? (
                    <span className="text-xs text-muted">—</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-strong">
                  {user.role === "ADMIN" ? "Everything" : user.rosterPagesOverride ? "Set by roster" : `${modulesOpenFor(user)}/${REPORT_MODULES.length} modules`}
                </span>
                <span className="text-xs text-muted-strong" title={user.allowedPrincipals.join(", ")}>
                  {PRINCIPAL_SCOPED_ROLES.has(user.role)
                    ? user.allowedPrincipals.length === 0
                      ? "All"
                      : `${user.allowedPrincipals.length} selected`
                    : user.role === "TEAM_LEADER" || user.role === "SUPERVISOR"
                      ? "From roster"
                      : "All"}
                </span>
                <span
                  className={`justify-self-end rounded-full px-3 py-1 text-center text-xs font-semibold md:w-full ${
                    isOpen ? "bg-background text-muted-strong" : "bg-accent-blue-soft text-primary-blue"
                  }`}
                >
                  {isOpen ? "Close" : "Manage"}
                </span>
              </button>
              {isOpen ? (
                <UserEditor
                  key={[user.id, user.role, user.teamLeaderId, user.supervisorId, user.employeeCode, user.allowedPages.join(","), user.allowedPrincipals.join(",")].join("|")}
                  user={user}
                  teamLeaders={teamLeaders}
                  supervisors={supervisors}
                  knownPrincipals={knownPrincipals}
                  isSelf={user.id === currentUserId}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LinkChip({ children }: { children: React.ReactNode }) {
  return <span className="max-w-full truncate rounded-full bg-background-elevated px-2 py-0.5 text-[11px] font-medium text-muted-strong">{children}</span>;
}

const sameSet = <T,>(a: ReadonlySet<T>, b: ReadonlySet<T>) => a.size === b.size && [...a].every((value) => b.has(value));

function UserEditor({
  user,
  teamLeaders,
  supervisors,
  knownPrincipals,
  isSelf,
}: {
  user: DirectoryUser;
  teamLeaders: TeamLeaderOption[];
  supervisors: SupervisorOption[];
  knownPrincipals: string[];
  isSelf: boolean;
}) {
  const savedRole: Role = isRole(user.role) ? user.role : "VIEWER";
  const savedPages = useMemo(() => new Set(user.allowedPages.filter(isPageKey)), [user.allowedPages]);
  const savedPrincipals = useMemo(() => new Set(user.allowedPrincipals), [user.allowedPrincipals]);
  const initialTeamLeaderId = user.teamLeaderId ?? user.suggestedTeamLeaderId ?? "";
  const initialSupervisorId = user.supervisorId ?? user.suggestedSupervisorId ?? "";

  const [role, setRole] = useState<Role>(savedRole);
  const [teamLeaderId, setTeamLeaderId] = useState(initialTeamLeaderId);
  const [supervisorId, setSupervisorId] = useState(initialSupervisorId);
  const [employeeCode, setEmployeeCode] = useState(user.employeeCode ?? "");
  const [pages, setPages] = useState<Set<PageKey>>(() => new Set(savedPages));
  const [principals, setPrincipals] = useState<Set<string>>(() => new Set(savedPrincipals));
  // Bumped by Discard so the principal picker's own All/Only-selected toggle resets with everything else.
  const [resetCount, setResetCount] = useState(0);

  const usesTeamLeader = roleUsesTeamLeaderLink(role);
  const usesSupervisor = roleUsesSupervisorLink(role);
  const principalScoped = PRINCIPAL_SCOPED_ROLES.has(role);
  const defaults = useMemo(() => new Set(ROLE_DEFAULT_PAGES[role]), [role]);
  const onDefaults = sameSet(pages, defaults);
  const roleChanged = role !== savedRole;
  const dirty =
    roleChanged ||
    (usesTeamLeader && teamLeaderId !== (user.teamLeaderId ?? "")) ||
    (usesSupervisor && supervisorId !== (user.supervisorId ?? "")) ||
    employeeCode.trim() !== (user.employeeCode ?? "") ||
    (role !== "ADMIN" && !sameSet(pages, savedPages)) ||
    (principalScoped && !sameSet(principals, savedPrincipals));
  const defaultModules = REPORT_MODULES.filter((module) => module.reports.some((report) => defaults.has(report.key))).map((module) => module.label);
  const teamLeaderOptions = teamLeaders.filter((tl) => isRealTeamLeader(tl.kind) || tl.id === user.teamLeaderId);

  function discard() {
    setRole(savedRole);
    setTeamLeaderId(initialTeamLeaderId);
    setSupervisorId(initialSupervisorId);
    setEmployeeCode(user.employeeCode ?? "");
    setPages(new Set(savedPages));
    setPrincipals(new Set(savedPrincipals));
    setResetCount((count) => count + 1);
  }

  return (
    <div className="border-t border-border/60 px-4 pb-4 pt-4 md:px-6">
      <form action={updateUserAccessAction} className="flex flex-col gap-4">
        <input type="hidden" name="userId" value={user.id} />
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(260px,330px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Role</span>
              <select name="role" value={role} onChange={(event) => setRole(event.target.value as Role)} className={inputClass}>
                {ALL_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABELS[value]}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-muted">{ROLE_DESCRIPTIONS[role]}</span>
            </label>

            {usesTeamLeader ? (
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>Team Leader roster entry</span>
                <select name="teamLeaderId" required value={teamLeaderId} onChange={(event) => setTeamLeaderId(event.target.value)} className={inputClass}>
                  <option value="">— pick one —</option>
                  {teamLeaderOptions.map((tl) => (
                    <option key={tl.id} value={tl.id}>
                      {tl.label}
                      {isRealTeamLeader(tl.kind) ? "" : " (not a team leader)"}
                    </option>
                  ))}
                </select>
                {!user.teamLeaderId && user.suggestedTeamLeaderId ? <span className="text-[11px] text-accent-green">Suggested from their email — save to confirm.</span> : null}
              </label>
            ) : null}

            {usesSupervisor ? (
              <label className="flex flex-col gap-1">
                <span className={fieldLabel}>Sales Supervisor roster entry</span>
                <select name="supervisorId" required value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)} className={inputClass}>
                  <option value="">— pick one —</option>
                  {supervisors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {!user.supervisorId && user.suggestedSupervisorId ? <span className="text-[11px] text-accent-green">Suggested from their email — save to confirm.</span> : null}
              </label>
            ) : null}

            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Employee code{role === "SALES_REP" ? " · needed for My Sales" : " · optional"}</span>
              <input name="employeeCode" value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} placeholder="e.g. 1181" className={inputClass} />
              {employeeCode.trim() !== (user.employeeCode ?? "") ? (
                <span className="text-[11px] text-muted">{employeeCode.trim() ? "Checked against the roster when you save." : "Saving clears the link."}</span>
              ) : user.employeeCode ? (
                user.employeeMatch ? (
                  <span className="text-[11px] text-accent-green">
                    {user.employeeMatch.pineName} (SAP: {user.employeeMatch.sapName}) — My Sales is on.
                  </span>
                ) : (
                  <span className="text-[11px] text-accent-red">This code is no longer on the roster — check it.</span>
                )
              ) : (
                <span className="text-[11px] text-muted">Links a rep&apos;s roster code to unlock their own My Sales page.</span>
              )}
            </label>

            {role === "TEAM_LEADER" && !roleChanged && user.teamLeaderId ? (
              <RosterNote
                text={
                  user.teamLeaderSummary && user.teamLeaderSummary.length > 0
                    ? user.teamLeaderSummary.map((p) => `${p.principal} (${p.repCount})`).join(", ")
                    : "Not assigned to any principal yet."
                }
                href={`/admin/team-leaders?filterTeamLeader=${user.teamLeaderId}`}
              />
            ) : null}
            {role === "SUPERVISOR" && !roleChanged && user.supervisorId ? (
              <RosterNote text={user.supervisorGroupSize ? `${user.supervisorGroupSize} Team Leader(s) in their group.` : "No Team Leaders with active reps in their group yet."} href="/admin/team-leaders" />
            ) : null}
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
            {role === "ADMIN" ? (
              <p className="text-sm text-muted-strong">Administrators see every report and every principal.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={fieldLabel}>Reports they see</span>
                  {!onDefaults ? (
                    <button
                      type="button"
                      onClick={() => setPages(new Set(defaults))}
                      title={defaultModules.length ? defaultModules.join(", ") : "No reports"}
                      className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${roleChanged ? "bg-accent-amber-soft text-accent-amber" : "text-primary-blue hover:bg-accent-blue-soft"}`}
                    >
                      {roleChanged ? `Role changed — use ${ROLE_LABELS[role]} defaults` : `Reset to ${ROLE_LABELS[role]} defaults`}
                    </button>
                  ) : null}
                </div>
                {user.rosterPagesOverride && !roleChanged && (role === "TEAM_LEADER" || role === "SUPERVISOR") ? (
                  <p className="rounded-xl bg-accent-amber-soft px-3 py-2 text-xs text-accent-amber">
                    Their roster entry sets which reports they see, which replaces these ticks — change it on{" "}
                    <Link href="/admin/team-leaders" className="font-semibold underline">
                      Team hierarchy
                    </Link>
                    .
                  </p>
                ) : null}
                {role === "SALES_REP" && pages.size === 0 ? (
                  <p className="text-xs text-muted">A Sales Rep sees only the reports ticked here{employeeCode.trim() ? ", plus their own My Sales" : " — add their employee code for My Sales"}.</p>
                ) : null}
                <ModuleAccessPicker role={role} selected={pages} onChange={setPages} />
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
              <span className={fieldLabel}>Principals</span>
              {principalScoped ? (
                <PrincipalPicker key={resetCount} knownPrincipals={knownPrincipals} selected={principals} onChange={setPrincipals} ownPrincipals={user.ownPrincipals} />
              ) : (
                <p className="text-xs text-muted">
                  {role === "TEAM_LEADER" || role === "SUPERVISOR" ? "Limited to their roster's principals and reps automatically." : "Company-wide — sees every principal."}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
            Save changes
          </button>
          {dirty ? (
            <>
              <span className="rounded-full bg-accent-amber-soft px-2.5 py-1 text-[11px] font-semibold text-accent-amber">Unsaved changes</span>
              <button type="button" onClick={discard} className="rounded-full px-3 py-2 text-xs font-semibold text-muted-strong hover:bg-background-elevated">
                Discard
              </button>
            </>
          ) : null}
        </div>
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
        <form action={resetPasswordAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="userId" value={user.id} />
          <input type="password" name="newPassword" minLength={8} required placeholder="New password (min 8)" aria-label="New password" className="w-52 rounded-full border border-border bg-surface px-3 py-1.5 text-xs outline-none focus:border-secondary-blue" />
          <button type="submit" className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
            Reset password
          </button>
        </form>
        <form action={deleteUserAction}>
          <input type="hidden" name="userId" value={user.id} />
          {isSelf ? (
            <span className="text-xs text-muted">This is your own account.</span>
          ) : (
            <ConfirmSubmitButton confirmMessage={`Remove ${user.email}? They will no longer be able to sign in.`} className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft">
              Remove user
            </ConfirmSubmitButton>
          )}
        </form>
      </div>
    </div>
  );
}

function RosterNote({ text, href }: { text: string; href: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-background-elevated px-3 py-2">
      <span className="text-xs text-muted-strong">{text}</span>
      <span className="flex gap-3">
        <Link href={href} className="text-xs font-medium text-primary-blue hover:underline">
          Manage assignments →
        </Link>
        <Link href="/weekly-targets" className="text-xs text-primary-blue hover:underline">
          Weekly targets →
        </Link>
      </span>
    </div>
  );
}
