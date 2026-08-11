import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { createPrincipalAction, updatePrincipalAction, deletePrincipalAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const selectClass = inputClass;
const labelClass = "text-[13px] font-medium text-muted-strong";

export default async function AdminPrincipalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, edit } = await searchParams;
  const [principals, teamLeaders] = await Promise.all([
    prisma.principal.findMany({ orderBy: { principal: "asc" } }),
    prisma.teamLeader.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const teamLeaderNameById = new Map(teamLeaders.map((tl) => [tl.id, tl.name]));
  const editing = edit ? principals.find((p) => p.id === edit) : undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Principals</h1>
        <p className="mt-1 text-sm text-white/70">
          Principal → location reference data used by the SQL bridge, and which Team Leader heads each principal — drives TL Ranking&apos;s MTD Revenue attribution.
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
          <h2 className="text-lg font-semibold text-primary-blue">Add a principal</h2>
          <form action={createPrincipalAction} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Principal (exact, e.g. &quot;EABL-Nyeri&quot;)</label>
              <input name="principal" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Main principal</label>
              <input name="mainPrincipal" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Location</label>
              <input name="location" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Location code</label>
              <input name="locationCode" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Status</label>
              <select name="status" defaultValue="Active" className={selectClass}>
                <option value="Active">Active</option>
                <option value="Past">Past</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Team Leader (heads this principal)</label>
              <select name="teamLeaderId" defaultValue="" className={selectClass}>
                <option value="">— none —</option>
                {teamLeaders.map((tl) => (
                  <option key={tl.id} value={tl.id}>
                    {tl.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add principal
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Principals ({principals.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Principal</th>
                  <th className="px-6 py-3 text-left font-medium">Main principal</th>
                  <th className="px-6 py-3 text-left font-medium">Location</th>
                  <th className="px-6 py-3 text-left font-medium">Status</th>
                  <th className="px-6 py-3 text-left font-medium">Team Leader</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {principals.map((p) =>
                  editing?.id === p.id ? (
                    <tr key={p.id} className="bg-accent-blue-soft/40">
                      <td colSpan={6} className="px-6 py-4 border-b border-border/60">
                        <form action={updatePrincipalAction} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                          <input type="hidden" name="principalId" value={p.id} />
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Principal</label>
                            <input value={p.principal} disabled className={inputClass + " opacity-60"} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Main principal</label>
                            <input name="mainPrincipal" defaultValue={p.mainPrincipal} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Location</label>
                            <input name="location" defaultValue={p.location} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Status</label>
                            <select name="status" defaultValue={p.status} className={selectClass}>
                              <option value="Active">Active</option>
                              <option value="Past">Past</option>
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Team Leader</label>
                            <select name="teamLeaderId" defaultValue={p.teamLeaderId ?? ""} className={selectClass}>
                              <option value="">— none —</option>
                              {teamLeaders.map((tl) => (
                                <option key={tl.id} value={tl.id}>
                                  {tl.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex gap-2 sm:col-span-5">
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href="/admin/principals" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td className="px-6 py-3 border-b border-border/60 font-medium">{p.principal}</td>
                      <td className="px-6 py-3 border-b border-border/60">{p.mainPrincipal}</td>
                      <td className="px-6 py-3 border-b border-border/60">{p.location}</td>
                      <td className="px-6 py-3 border-b border-border/60">{p.status}</td>
                      <td className="px-6 py-3 border-b border-border/60">
                        {p.teamLeaderId ? teamLeaderNameById.get(p.teamLeaderId) ?? "—" : <span className="text-accent-amber">Unowned</span>}
                      </td>
                      <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                        <Link href={`/admin/principals?edit=${p.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                          Edit
                        </Link>
                        <form action={deletePrincipalAction} className="inline">
                          <input type="hidden" name="principalId" value={p.id} />
                          <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {principals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-muted">
                      No principals yet.
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
