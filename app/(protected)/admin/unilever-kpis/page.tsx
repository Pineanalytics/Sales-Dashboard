import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SALES_RETURNS_BRANCH_LABELS } from "@/lib/salesReturnsControl";
import { AdminBadge, AdminCard, AdminNotices, AdminPage, adminTable } from "@/components/admin/AdminPage";
import { upsertTargetAction, deleteTargetAction, addAssortmentSkuAction, toggleAssortmentSkuAction, deleteAssortmentSkuAction } from "./actions";

export const dynamic = "force-dynamic";

const inputClass = "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";
const labelClass = "text-[13px] font-medium text-muted-strong";

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function AdminUnileverKpisPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string; month?: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  const { error, success, month: monthParam } = await searchParams;
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonthValue();
  const [year, mo] = month.split("-").map(Number);
  const monthDate = new Date(Date.UTC(year, mo - 1, 1));

  const [targets, assortmentSkus, knownPjps] = await Promise.all([
    prisma.unileverKpiTarget.findMany({ where: { month: monthDate }, orderBy: [{ distributor: "asc" }, { pjp: "asc" }] }),
    prisma.unileverAssortmentSku.findMany({ orderBy: { sku: "asc" } }),
    prisma.pjpSkuPerformance.findMany({ distinct: ["distributor", "pjp"], select: { distributor: true, pjp: true, route: true }, orderBy: { pjp: "asc" } }),
  ]);

  return (
    <AdminPage
      title="Unilever KPI setup"
      description="The two inputs the Unilever Individual Sales Productivity card on Principal KPIs can't get from the synced Centegy data: each PJP's monthly sales target, and the core assortment SKU basket for Perfect Assortment. Sales, LPPC and execution counts are computed live."
      stats={[
        { label: `PJP targets for ${month}`, value: targets.length },
        { label: "active basket SKUs", value: assortmentSkus.filter((row) => row.active).length, tone: assortmentSkus.some((row) => row.active) ? "default" : "attention" },
      ]}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
      <div className="flex flex-col gap-4">
        <AdminCard
          title={`PJP sales targets — ${month}`}
          actions={
            <form method="get" className="flex items-center gap-2">
              <label className="sr-only" htmlFor="month-picker">Month</label>
              <input id="month-picker" type="month" name="month" defaultValue={month} className={inputClass} />
              <button type="submit" className="rounded-full bg-background-elevated px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Go</button>
            </form>
          }
        >
          <form action={upsertTargetAction} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <input type="hidden" name="month" value={month} />
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Distributor</label>
              <select name="distributor" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select branch</option>
                {Object.entries(SALES_RETURNS_BRANCH_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>PJP (route code)</label>
              <select name="pjp" defaultValue="" className={inputClass}>
                <option value="">— choose existing —</option>
                {knownPjps.map((row) => (
                  <option key={`${row.distributor}-${row.pjp}`} value={row.pjp}>{row.pjp} ({row.route})</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Or a new PJP code</label>
              <input name="newPjp" placeholder="VAN_A_OB" className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Sales Target (KES)</label>
              <input name="salesTarget" type="number" step="any" required className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
                Save target
              </button>
            </div>
          </form>
        </AdminCard>

        <AdminCard flush title={<>Targets for {month} <AdminBadge>{targets.length}</AdminBadge></>}>
          <div className="overflow-x-auto">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>Branch</th>
                  <th className={adminTable.th}>PJP</th>
                  <th className={adminTable.thRight}>Sales Target (KES)</th>
                  <th className={adminTable.thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t.id}>
                    <td className={adminTable.td}>{SALES_RETURNS_BRANCH_LABELS[t.distributor] ?? t.distributor}</td>
                    <td className={adminTable.td}>{t.pjp}</td>
                    <td className={adminTable.tdRight}>{t.salesTarget.toLocaleString("en-US")}</td>
                    <td className={adminTable.tdRight}>
                      <form action={deleteTargetAction} className="inline">
                        <input type="hidden" name="targetId" value={t.id} />
                        <input type="hidden" name="month" value={month} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={adminTable.empty}>No targets set for {month} yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </AdminCard>
      </div>

        <AdminCard
          flush
          title={<>Core assortment basket <AdminBadge>{assortmentSkus.length}</AdminBadge></>}
          description="Perfect Assortment stays “pending” on the KPI card until this list has at least one active SKU. An outlet counts as perfectly assorted for a month once it has bought every active SKU below at least once."
        >
          <form action={addAssortmentSkuAction} className="flex flex-wrap items-end gap-3 px-5 py-4">
            <div className="flex flex-col gap-2">
              <label className={labelClass}>SKU code</label>
              <input name="sku" required className={inputClass} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={labelClass}>Description (optional)</label>
              <input name="skuDesc" className={inputClass} />
            </div>
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
              Add SKU
            </button>
          </form>

          <div className="overflow-x-auto border-t border-border/60">
            <table className={adminTable.table}>
              <thead className={adminTable.head}>
                <tr>
                  <th className={adminTable.th}>SKU</th>
                  <th className={adminTable.th}>Description</th>
                  <th className={adminTable.th}>Status</th>
                  <th className={adminTable.thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {assortmentSkus.map((row) => (
                  <tr key={row.id}>
                    <td className={adminTable.td}>{row.sku}</td>
                    <td className={adminTable.td}>{row.skuDesc ?? "—"}</td>
                    <td className={adminTable.td}>
                      <span className={row.active ? "text-accent-green" : "text-muted"}>{row.active ? "Active" : "Inactive"}</span>
                    </td>
                    <td className={`${adminTable.tdRight} whitespace-nowrap`}>
                      <form action={toggleAssortmentSkuAction} className="inline">
                        <input type="hidden" name="skuId" value={row.id} />
                        <input type="hidden" name="active" value={String(row.active)} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft transition-colors duration-300">
                          {row.active ? "Deactivate" : "Activate"}
                        </button>
                      </form>
                      <form action={deleteAssortmentSkuAction} className="inline">
                        <input type="hidden" name="skuId" value={row.id} />
                        <button type="submit" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft transition-colors duration-300">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {assortmentSkus.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={adminTable.empty}>No SKUs in the basket yet — Perfect Assortment stays pending until at least one is added.</td>
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
