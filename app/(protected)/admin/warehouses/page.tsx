import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { AdminCard, AdminNotices, AdminPage, adminTable, searchText } from "@/components/admin/AdminPage";
import { AdminTableSearch } from "@/components/admin/AdminTableSearch";
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
  const locations = new Set(warehouses.map((w) => w.location).filter(Boolean)).size;

  return (
    <AdminPage
      title="Warehouses"
      description="Warehouse → location reference data used by the SQL bridge."
      stats={[
        { label: "warehouses", value: warehouses.length },
        { label: "locations", value: locations },
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <AdminCard title="Add a warehouse" className="xl:sticky xl:top-28">
          <form action={createWarehouseAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Warehouse code</label>
              <input name="warehouseCode" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Warehouse name</label>
              <input name="warehouseName" className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Location</label>
              <input name="location" className={inputClass} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Location code</label>
              <input name="locationCode" className={inputClass} />
            </div>
            <div className="sm:col-span-2 xl:col-span-1">
              <button
                type="submit"
                className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
              >
                Add warehouse
              </button>
            </div>
          </form>
        </AdminCard>

        <AdminCard flush title={`Warehouses (${warehouses.length})`} actions={<AdminTableSearch target="warehouses" placeholder="Search code, name or location" />}>
          <div className="overflow-x-auto" data-filter-root="warehouses">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>Code</th>
                  <th className={adminTable.th}>Name</th>
                  <th className={adminTable.th}>Location</th>
                  <th className={adminTable.th}>Location code</th>
                  <th className={adminTable.thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) =>
                  editing?.id === w.id ? (
                    <tr key={w.id} className="bg-accent-blue-soft/40">
                      <td colSpan={5} className="border-b border-border/60 px-4 py-4">
                        <form action={updateWarehouseAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
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
                    <tr key={w.id} data-search={searchText(w.warehouseCode, w.warehouseName, w.location, w.locationCode)}>
                      <td className={`${adminTable.td} font-medium`}>{w.warehouseCode}</td>
                      <td className={adminTable.td}>{w.warehouseName}</td>
                      <td className={adminTable.td}>{w.location}</td>
                      <td className={adminTable.td}>{w.locationCode}</td>
                      <td className={`${adminTable.tdRight} whitespace-nowrap`}>
                        <Link href={`/admin/warehouses?edit=${w.id}`} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue transition-colors duration-300 hover:bg-accent-blue-soft">
                          Edit
                        </Link>
                        <form action={deleteWarehouseAction} className="inline">
                          <input type="hidden" name="warehouseId" value={w.id} />
                          <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-accent-red transition-colors duration-300 hover:bg-accent-red-soft">
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                )}
                {warehouses.length === 0 ? (
                  <tr>
                    <td colSpan={5} className={adminTable.empty}>
                      No warehouses yet.
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
