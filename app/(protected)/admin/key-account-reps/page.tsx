import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { AdminCard, AdminNotices, AdminPage, adminTable, searchText } from "@/components/admin/AdminPage";
import { AdminTableSearch } from "@/components/admin/AdminTableSearch";
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
  const teamLeaderCount = new Set(reps.map((r) => r.teamLeader).filter(Boolean)).size;

  return (
    <AdminPage
      title="Key Account Reps"
      description="Rep → channel/team-leader reference data."
      stats={[
        { label: "reps", value: reps.length },
        { label: "team leaders", value: teamLeaderCount },
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <AdminCard title="Add a key account rep" className="xl:sticky xl:top-28">
          <form action={createKeyAccountRepAction} className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Rep name</label>
              <input name="rep" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Channel</label>
              <input name="channel" defaultValue="Key Accounts" className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Team leader</label>
              <input name="teamLeader" className={inputClass} />
            </div>
            <div className="sm:col-span-3 xl:col-span-1">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add rep
              </button>
            </div>
          </form>
        </AdminCard>

        <AdminCard flush title={`Key Account Reps (${reps.length})`} actions={<AdminTableSearch target="key-account-reps" placeholder="Search rep, channel or team leader" />}>
          <div className="overflow-x-auto" data-filter-root="key-account-reps">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>Rep</th>
                  <th className={adminTable.th}>Channel</th>
                  <th className={adminTable.th}>Team leader</th>
                  <th className={adminTable.thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reps.map((r) =>
                  editing?.id === r.id ? (
                    <tr key={r.id} className="bg-accent-blue-soft/40">
                      <td colSpan={4} className="border-b border-border/60 px-4 py-4">
                        <form action={updateKeyAccountRepAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-3">
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
                    <tr key={r.id} data-search={searchText(r.rep, r.channel, r.teamLeader)}>
                      <td className={`${adminTable.td} font-medium`}>{r.rep}</td>
                      <td className={adminTable.td}>{r.channel}</td>
                      <td className={adminTable.td}>{r.teamLeader}</td>
                      <td className={`${adminTable.tdRight} whitespace-nowrap`}>
                        <Link href={`/admin/key-account-reps?edit=${r.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue transition-colors duration-300 hover:bg-accent-blue-soft">
                          Edit
                        </Link>
                        <form action={deleteKeyAccountRepAction} className="inline">
                          <input type="hidden" name="repId" value={r.id} />
                          <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-accent-red transition-colors duration-300 hover:bg-accent-red-soft">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {reps.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={adminTable.empty}>
                      No key account reps yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </AdminCard>
      </div>
    </AdminPage>
  );
}
