"use client";

import { useState } from "react";
import Link from "next/link";
import { isRealTeamLeader } from "@/lib/teamLeaderKind";
import { ALL_PAGE_KEYS, PAGE_LABELS, type PageKey } from "@/lib/pageAccess";
import { UserAccessToolbar, type UserRole } from "@/components/admin/UserAccessToolbar";
import {
  deleteUserAction,
  updateUserRoleAction,
  updateUserPagesAction,
  updateUserPrincipalsAction,
  updateUserEmployeeCodeAction,
  resetPasswordAction,
} from "@/app/(protected)/admin/users/actions";

export interface TeamLeaderOption {
  id: string;
  label: string;
  kind: string | null;
}

export interface SupervisorOption {
  id: string;
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
}

const PRINCIPAL_SCOPED_ROLES = new Set(["VIEWER", "SALES_ADMIN", "FINANCE_MANAGER", "ACCOUNTANT", "LOGISTICS_MANAGER"]);

/** The "Users" list and its search toolbar — split out as a client component, and the
 *  per-row expand/collapse kept as React state (not a native <details>), so the row a
 *  server action was just submitted from stays open and in place once its redirect
 *  lands. A native <details>'s `open` does NOT survive that redirect here (verified:
 *  the whole subtree re-renders from the fresh server payload, which carries no `open`
 *  attribute) — forceOpenUserId (echoed back by every per-user action's redirect, see
 *  actions.ts) seeds this component's own open-row state instead, so the admin can
 *  make several edits to the same user — role, then pages, then principals — without
 *  re-finding them in the list after each save. */
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

  function toggle(id: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAndScroll(id: string) {
    setOpenIds((current) => (current.has(id) ? current : new Set(current).add(id)));
    // Deferred so the row's content has already expanded (and the page grown taller)
    // by the time the scroll runs — scrollIntoView acting on the pre-expand layout
    // would undershoot.
    requestAnimationFrame(() => {
      document.getElementById(`user-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <>
      <UserAccessToolbar
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role as UserRole }))}
        onOpenUser={openAndScroll}
      />

      <div id="user-directory" className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="p-6 pb-0">
          <h2 className="text-lg font-semibold text-primary-blue">Users ({users.length})</h2>
        </div>
        <div className="flex flex-col divide-y divide-border/60 mt-4">
          {users.map((u) => {
            const isOpen = openIds.has(u.id);
            const teamLeaderOptions = teamLeaders.filter((tl) => isRealTeamLeader(tl.kind) || tl.id === u.teamLeaderId);
            return (
              <div key={u.id} id={`user-${u.id}`} data-user-row data-user-search={`${u.name ?? ""} ${u.email}`.toLowerCase()} data-user-role={u.role} className="scroll-mt-40 border-b border-border/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(u.id)}
                  aria-expanded={isOpen}
                  className="flex w-full cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-6 py-4 text-left hover:bg-background-elevated"
                >
                  <span>
                    <span className="block font-semibold text-foreground">{u.name || u.email}</span>
                    <span className="mt-0.5 block text-xs text-muted">{u.email} · {u.role.replace("_", " ")}</span>
                  </span>
                  {isOpen ? (
                    <span className="rounded-full bg-background px-3 py-1.5 text-xs font-semibold text-muted-strong">Hide settings</span>
                  ) : (
                    <span className="rounded-full bg-accent-blue-soft px-3 py-1.5 text-xs font-semibold text-primary-blue">Manage access</span>
                  )}
                </button>
                {isOpen ? (
                  <div className="flex flex-col gap-4 border-t border-border/60 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-foreground">{u.name || u.email}</div>
                        <div className="text-xs text-muted">
                          {u.email} · Joined {u.createdAtLabel}
                        </div>
                      </div>
                      <form action={deleteUserAction} className="inline">
                        <input type="hidden" name="userId" value={u.id} />
                        <button
                          type="submit"
                          disabled={u.id === currentUserId}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
                          title={u.id === currentUserId ? "You can't delete your own account" : "Delete user"}
                        >
                          Remove
                        </button>
                      </form>
                    </div>

                    <div className="flex flex-wrap items-end gap-6">
                      <form action={updateUserRoleAction} className="flex items-end gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Role</span>
                          <select
                            name="role"
                            defaultValue={u.role}
                            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
                          >
                            <option value="VIEWER">Viewer</option>
                            <option value="ADMIN">Admin</option>
                            <option value="TEAM_LEADER">Team Leader</option>
                            <option value="SUPERVISOR">Sales Supervisor</option>
                            <option value="HOD">Head of Sales</option>
                            <option value="DIRECTOR">Director</option>
                            <option value="SALES_ADMIN">Sales Admin</option>
                            <option value="FINANCE_MANAGER">Finance Manager</option>
                            <option value="ACCOUNTANT">Accountant</option>
                            <option value="LOGISTICS_MANAGER">Logistics Manager</option>
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Team Leader link</span>
                          <select
                            name="teamLeaderId"
                            defaultValue={u.teamLeaderId ?? u.suggestedTeamLeaderId ?? ""}
                            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
                          >
                            <option value="">— none —</option>
                            {teamLeaderOptions.map((tl) => (
                              <option key={tl.id} value={tl.id}>
                                {tl.label}
                                {isRealTeamLeader(tl.kind) ? "" : " (not a team leader)"}
                              </option>
                            ))}
                          </select>
                          {!u.teamLeaderId && u.suggestedTeamLeaderId ? (
                            <span className="text-[11px] text-accent-green">Suggested from matching email — Save role to confirm.</span>
                          ) : null}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Supervisor link</span>
                          <select
                            name="supervisorId"
                            defaultValue={u.supervisorId ?? u.suggestedSupervisorId ?? ""}
                            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
                          >
                            <option value="">— none —</option>
                            {supervisors.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                          {!u.supervisorId && u.suggestedSupervisorId ? (
                            <span className="text-[11px] text-accent-green">Suggested from matching email — Save role to confirm.</span>
                          ) : null}
                        </div>
                        <button
                          type="submit"
                          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Save role
                        </button>
                      </form>

                      <form action={resetPasswordAction} className="flex items-end gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">New password</span>
                          <input
                            type="password"
                            name="newPassword"
                            minLength={8}
                            placeholder="min 8 characters"
                            className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
                          />
                        </div>
                        <button
                          type="submit"
                          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Reset password
                        </button>
                      </form>
                    </div>

                    <form action={updateUserEmployeeCodeAction} className="flex flex-col gap-1.5">
                      <input type="hidden" name="userId" value={u.id} />
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Employee Code link (optional, any role)</span>
                      <div className="flex items-end gap-2">
                        <input
                          type="text"
                          name="employeeCode"
                          defaultValue={u.employeeCode ?? ""}
                          placeholder="e.g. 1181"
                          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
                        />
                        <button
                          type="submit"
                          className="rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Save link
                        </button>
                      </div>
                      {u.employeeCode ? (
                        u.employeeMatch ? (
                          <span className="text-[11px] text-accent-green">
                            Linked to {u.employeeMatch.pineName} (SAP: {u.employeeMatch.sapName}) — their &quot;My Sales&quot; module is unlocked.
                          </span>
                        ) : (
                          <span className="text-[11px] text-accent-red">No roster entry found for this code anymore — check it&apos;s still correct.</span>
                        )
                      ) : (
                        <span className="text-[11px] text-muted">Unlocks a personal &quot;My Sales&quot; module showing just their own rep-level sales.</span>
                      )}
                    </form>

                    {u.role === "ADMIN" ? (
                      <span className="text-xs text-muted">Administrators always see every report.</span>
                    ) : (
                      <form action={updateUserPagesAction} className="flex flex-col gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Report visibility</span>
                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                          {ALL_PAGE_KEYS.map((key: PageKey) => (
                            <label key={key} className="inline-flex items-center gap-1.5 text-xs text-muted-strong">
                              <input
                                type="checkbox"
                                name="pages"
                                value={key}
                                defaultChecked={u.allowedPages.includes(key)}
                                className="rounded border-border text-primary-blue focus:ring-secondary-blue"
                              />
                              {PAGE_LABELS[key]}
                            </label>
                          ))}
                        </div>
                        <button
                          type="submit"
                          className="mt-1 self-start rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Save visibility
                        </button>
                      </form>
                    )}

                    {PRINCIPAL_SCOPED_ROLES.has(u.role) ? (
                      <form action={updateUserPrincipalsAction} className="flex flex-col gap-2">
                        <input type="hidden" name="userId" value={u.id} />
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                          Principal visibility {u.allowedPrincipals.length === 0 ? "(unrestricted — sees every principal)" : `(restricted to ${u.allowedPrincipals.length})`}
                        </span>
                        <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-2 overflow-y-auto rounded-xl bg-background-elevated p-3">
                          {knownPrincipals.length === 0 ? (
                            <span className="text-xs text-muted">No principals found yet.</span>
                          ) : (
                            knownPrincipals.map((p) => (
                              <label key={p} className="inline-flex items-center gap-1.5 text-xs text-muted-strong">
                                <input
                                  type="checkbox"
                                  name="principals"
                                  value={p}
                                  defaultChecked={u.allowedPrincipals.includes(p)}
                                  className="rounded border-border text-primary-blue focus:ring-secondary-blue"
                                />
                                {p}
                              </label>
                            ))
                          )}
                        </div>
                        <span className="text-xs text-muted">Leave every box unchecked for unrestricted (default). Check one or more to limit this login to just those principals, everywhere in the app.</span>
                        <button
                          type="submit"
                          className="mt-1 self-start rounded-full border border-border px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300"
                        >
                          Save principal visibility
                        </button>
                      </form>
                    ) : null}

                    {u.role === "TEAM_LEADER" ? (
                      <div className="rounded-xl bg-background-elevated px-4 py-3 flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Principals &amp; reps</span>
                        {!u.teamLeaderId ? (
                          <span className="text-xs text-muted">No Team Leader linked yet — set one above to assign principals/reps.</span>
                        ) : u.teamLeaderSummary === null || u.teamLeaderSummary.length === 0 ? (
                          <span className="text-xs text-muted">Not assigned to any principal yet.</span>
                        ) : (
                          <span className="text-xs text-muted-strong">
                            {u.teamLeaderSummary.map((p) => `${p.principal} (${p.repCount} rep${p.repCount === 1 ? "" : "s"})`).join(", ")}
                          </span>
                        )}
                        <div className="flex items-center gap-3 mt-0.5">
                          <Link
                            href={u.teamLeaderId ? `/admin/team-leaders?filterTeamLeader=${u.teamLeaderId}` : "/admin/team-leaders"}
                            className="text-xs font-medium text-primary-blue hover:underline"
                          >
                            Manage assignments →
                          </Link>
                          <Link href="/weekly-targets" className="text-xs text-primary-blue hover:underline">
                            Weekly Targets →
                          </Link>
                        </div>
                      </div>
                    ) : null}
                    {u.role === "SUPERVISOR" ? (
                      <div className="rounded-xl bg-background-elevated px-4 py-3 flex flex-col gap-1.5">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Team Leaders in their group</span>
                        {!u.supervisorId ? (
                          <span className="text-xs text-muted">No Sales Supervisor linked yet — set one above to assign a group.</span>
                        ) : !u.supervisorGroupSize ? (
                          <span className="text-xs text-muted">No Team Leaders with active reps under this Supervisor yet.</span>
                        ) : (
                          <span className="text-xs text-muted-strong">
                            {u.supervisorGroupSize} Team Leader(s) — full roster/target CRUD for their whole group.
                          </span>
                        )}
                        <div className="flex items-center gap-3 mt-0.5">
                          <Link href="/admin/team-leaders" className="text-xs font-medium text-primary-blue hover:underline">
                            Manage assignments →
                          </Link>
                          <Link href="/weekly-targets" className="text-xs text-primary-blue hover:underline">
                            Weekly Targets →
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
