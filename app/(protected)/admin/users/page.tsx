import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { createUserAction, deleteUserAction } from "./actions";

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
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(8,36,94,0.25)]">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-white transition-colors">
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Manage Users</h1>
        <p className="mt-1 text-sm text-white/70">Create admin or viewer accounts for the Pinefrost Limited Performance Dashboard.</p>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 flex flex-col gap-6">
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
              </select>
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-button-blue px-5 py-3 text-sm font-semibold text-white transition-colors duration-300 hover:bg-button-blue-hover"
              >
                Create user
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Users ({users.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Name</th>
                  <th className="px-6 py-3 text-left font-medium">Email</th>
                  <th className="px-6 py-3 text-left font-medium">Role</th>
                  <th className="px-6 py-3 text-left font-medium">Created</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-6 py-3 border-b border-border/60">{u.name || "—"}</td>
                    <td className="px-6 py-3 border-b border-border/60">{u.email}</td>
                    <td className="px-6 py-3 border-b border-border/60">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.role === "ADMIN" ? "bg-accent-purple-soft text-accent-purple" : "bg-accent-grey-soft text-muted-strong"
                        }`}
                      >
                        {u.role === "ADMIN" ? "Administrator" : "Viewer"}
                      </span>
                    </td>
                    <td className="px-6 py-3 border-b border-border/60 text-muted">{u.createdAt.toLocaleDateString()}</td>
                    <td className="px-6 py-3 border-b border-border/60 text-right">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
