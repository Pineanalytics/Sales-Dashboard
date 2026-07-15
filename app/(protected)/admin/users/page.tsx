import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ALL_PAGE_KEYS, PAGE_LABELS } from "@/lib/pageAccess";
import { ANNOUNCEMENT_TEMPLATE_KEY, DEFAULT_ANNOUNCEMENT_SUBJECT, DEFAULT_ANNOUNCEMENT_BODY } from "@/lib/email";
import { ConfirmSubmitButton } from "@/components/ui/ConfirmSubmitButton";
import {
  createUserAction,
  deleteUserAction,
  approveUserAction,
  rejectUserAction,
  updateUserRoleAction,
  updateUserPagesAction,
  resetPasswordAction,
  saveAnnouncementTemplateAction,
  resetAnnouncementTemplateAction,
  sendNewModulesAnnouncementAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success } = await searchParams;
  const allUsers = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const pending = allUsers.filter((u) => u.status === "PENDING");
  const approved = allUsers.filter((u) => u.status === "APPROVED");
  const teamLeaders = await prisma.teamLeader.findMany({ orderBy: { name: "asc" } });
  const announcementTemplate = await prisma.emailTemplate.findUnique({ where: { key: ANNOUNCEMENT_TEMPLATE_KEY } });
  const announcementSubject = announcementTemplate?.subject ?? DEFAULT_ANNOUNCEMENT_SUBJECT;
  const announcementBody = announcementTemplate?.body ?? DEFAULT_ANNOUNCEMENT_BODY;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
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
                    <th className="px-6 py-3 text-left font-medium">Requested</th>
                    <th className="px-6 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((u) => (
                    <tr key={u.id}>
                      <td className="px-6 py-3 border-b border-border/60">{u.name || "—"}</td>
                      <td className="px-6 py-3 border-b border-border/60">{u.email}</td>
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

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <h2 className="text-lg font-semibold text-primary-blue">Add a new user</h2>
          <form action={createUserAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="name" className="text-[13px] font-medium text-muted-strong">
                Name (optional)
              </label>
              <input
                id="name"
                name="name"
                type="text"
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-[13px] font-medium text-muted-strong">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-[13px] font-medium text-muted-strong">
                Password (min 8 characters)
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                minLength={8}
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="role" className="text-[13px] font-medium text-muted-strong">
                Role
              </label>
              <select
                id="role"
                name="role"
                defaultValue="VIEWER"
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
              >
                <option value="VIEWER">Viewer — read-only dashboard access</option>
                <option value="ADMIN">Admin — can upload new snapshots</option>
                <option value="TEAM_LEADER">Team Leader — enters their own Weekly Targets</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="teamLeaderId" className="text-[13px] font-medium text-muted-strong">
                Team Leader link (only used if Role is Team Leader)
              </label>
              <select
                id="teamLeaderId"
                name="teamLeaderId"
                defaultValue=""
                className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
              >
                <option value="">— none —</option>
                {teamLeaders.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Create user
              </button>
            </div>
          </form>
          {teamLeaders.length === 0 ? (
            <p className="mt-2 text-xs text-muted">
              No Team Leaders exist yet — add them on the <Link href="/admin/team-leaders" className="text-primary-blue hover:underline">Team Leaders</Link> page first.
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

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Users ({approved.length})</h2>
          </div>
          <div className="flex flex-col divide-y divide-border/60 mt-4">
            {approved.map((u) => (
              <div key={u.id} className="p-6 flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-foreground">{u.name || u.email}</div>
                    <div className="text-xs text-muted">
                      {u.email} · Joined {u.createdAt.toLocaleDateString()}
                    </div>
                  </div>
                  <form action={deleteUserAction} className="inline">
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      type="submit"
                      disabled={u.id === session.user.id}
                      className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={u.id === session.user.id ? "You can't delete your own account" : "Delete user"}
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
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Team Leader link</span>
                      <select
                        name="teamLeaderId"
                        defaultValue={u.teamLeaderId ?? ""}
                        className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none focus:border-secondary-blue"
                      >
                        <option value="">— none —</option>
                        {teamLeaders.map((tl) => (
                          <option key={tl.id} value={tl.id}>
                            {tl.name}
                          </option>
                        ))}
                      </select>
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

                {u.role === "VIEWER" ? (
                  <form action={updateUserPagesAction} className="flex flex-col gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Report visibility</span>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {ALL_PAGE_KEYS.map((key) => (
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
                ) : u.role === "ADMIN" ? (
                  <span className="text-xs text-muted">Administrators always see every report.</span>
                ) : (
                  <span className="text-xs text-muted">
                    Team Leaders use <Link href="/weekly-targets" className="text-primary-blue hover:underline">Weekly Targets</Link>, scoped to their own team — not the report pages above.
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
