import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { createWarehouseAction, updateWarehouseAction, deleteWarehouseAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass =
  "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

export default async function AdminWarehousesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; edit?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, edit } = await searchParams;
  const warehouses = await prisma.warehouse.findMany({ orderBy: { warehouseCode: "asc" } });
  const editing = edit ? warehouses.find((w) => w.id === edit) : undefined;

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Warehouses</h1>
        <p className="mt-1 text-sm text-white/70">Warehouse → location reference data used by the SQL bridge.</p>
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
          <h2 className="text-lg font-semibold text-primary-blue">Add a warehouse</h2>
          <form action={createWarehouseAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Warehouse code</label>
              <input name="warehouseCode" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Warehouse name</label>
              <input name="warehouseName" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Location</label>
              <input name="location" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Location code</label>
              <input name="locationCode" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add warehouse
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="p-6 pb-0">
            <h2 className="text-lg font-semibold text-primary-blue">Warehouses ({warehouses.length})</h2>
          </div>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Code</th>
                  <th className="px-6 py-3 text-left font-medium">Name</th>
                  <th className="px-6 py-3 text-left font-medium">Location</th>
                  <th className="px-6 py-3 text-left font-medium">Location code</th>
                  <th className="px-6 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) =>
                  editing?.id === w.id ? (
                    <tr key={w.id} className="bg-accent-blue-soft/40">
                      <td colSpan={5} className="px-6 py-4 border-b border-border/60">
                        <form action={updateWarehouseAction} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                          <input type="hidden" name="warehouseId" value={w.id} />
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Code</label>
                            <input value={w.warehouseCode} disabled className={inputClass + " opacity-60"} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Name</label>
                            <input name="warehouseName" defaultValue={w.warehouseName} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Location</label>
                            <input name="location" defaultValue={w.location} className={inputClass} />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className={labelClass}>Location code</label>
                            <input name="locationCode" defaultValue={w.locationCode} className={inputClass} />
                          </div>
                          <div className="flex gap-2 sm:col-span-4">
                            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                              Save
                            </button>
                            <Link href="/admin/warehouses" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <tr key={w.id}>
                      <td className="px-6 py-3 border-b border-border/60 font-medium">{w.warehouseCode}</td>
                      <td className="px-6 py-3 border-b border-border/60">{w.warehouseName}</td>
                      <td className="px-6 py-3 border-b border-border/60">{w.location}</td>
                      <td className="px-6 py-3 border-b border-border/60">{w.locationCode}</td>
                      <td className="px-6 py-3 border-b border-border/60 text-right whitespace-nowrap">
                        <Link href={`/admin/warehouses?edit=${w.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                          Edit
                        </Link>
                        <form action={deleteWarehouseAction} className="inline">
                          <input type="hidden" name="warehouseId" value={w.id} />
                          <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {warehouses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-muted">
                      No warehouses yet.
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
