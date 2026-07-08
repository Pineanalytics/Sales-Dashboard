import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { createKeyAccountRepAction, updateKeyAccountRepAction, deleteKeyAccountRepAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

export default async function AdminKeyAccountRepsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, edit } = await searchParams;
  const reps = await prisma.keyAccountRep.findMany({ orderBy: { rep: "asc" } });
  const editing = edit ? reps.find((r) => r.id === edit) : undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Key Account Reps</h1>
        <p className="mt-1 text-sm text-white/70">Rep → channel/team-leader reference data.</p>
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
          <h2 className="text-lg font-semibold text-primary-blue">Add a key account rep</h2>
          <form action={createKeyAccountRepAction} className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Rep name</label>
              <input name="rep" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Channel</label>
              <input name="channel" defaultValue="Key Accounts" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Team leader</label>
              <input name="teamLeader" className={inputClass} />
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add rep
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Key Account Reps ({reps.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Rep</th>
                  <th className="px-6 py-3 text-left font-medium">Channel</th>
                  <th className="px-6 py-3 text-left font-medium">Team leader</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) =>
                  editing?.id === r.id ? (
                    <tr key={r.id} className="bg-accent-blue-soft/40">
                      <td colSpan={4} className="px-6 py-4 border-b border-border/60">
                        <form action={updateKeyAccountRepAction} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                          <input type="hidden" name="repId" value={r.id} />
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Rep</label>
                            <input value={r.rep} disabled className={inputClass + " opacity-60"} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Channel</label>
                            <input name="channel" defaultValue={r.channel} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Team leader</label>
                            <input name="teamLeader" defaultValue={r.teamLeader} className={inputClass} />
                          </div>
                          <div className="flex gap-2 sm:col-span-3">
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href="/admin/key-account-reps" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.id}>
                      <td className="px-6 py-3 border-b border-border/60 font-medium">{r.rep}</td>
                      <td className="px-6 py-3 border-b border-border/60">{r.channel}</td>
                      <td className="px-6 py-3 border-b border-border/60">{r.teamLeader}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                        <Link href={`/admin/key-account-reps?edit=${r.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                          Edit
                        </Link>
                        <form action={deleteKeyAccountRepAction} className="inline">
                          <input type="hidden" name="repId" value={r.id} />
                          <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {reps.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-muted">
                      No key account reps yet.
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
