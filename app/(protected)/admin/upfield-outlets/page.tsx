import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUpfieldOutletMasterStatus } from "@/lib/upfieldOutletMasterStore";
import { AdminCard, AdminNotices, AdminPage } from "@/components/admin/AdminPage";
import { uploadUpfieldOutletMasterAction } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("en-KE");

function Breakdown({ title, rows }: { title: string; rows: { name: string; outlets: number; bought: number }[] }) {
  return (
    <AdminCard title={title}>
      <div className="max-h-[420px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[12px] uppercase tracking-wide text-muted">
            <th className="py-1.5 pr-3 font-medium">Name</th>
            <th className="py-1.5 pr-3 text-right font-medium">Outlets</th>
            <th className="py-1.5 text-right font-medium">Bought, 90 days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-border/60">
              <td className="py-1.5 pr-3 text-foreground">{row.name}</td>
              <td className="py-1.5 pr-3 text-right">{fmt(row.outlets)}</td>
              <td className="py-1.5 text-right text-muted">
                {fmt(row.bought)} ({row.outlets > 0 ? Math.round((row.bought / row.outlets) * 100) : 0}%)
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </AdminCard>
  );
}

export default async function AdminUpfieldOutletsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const { error, success } = await searchParams;
  const status = await getUpfieldOutletMasterStatus();

  return (
    <AdminPage
      title="Upfield outlet list"
      description="Upfield's official customer master: every outlet with its type, channel, route and GPS point."
      stats={status.total > 0 ? [{ label: "outlets", value: fmt(status.total) }] : []}
    >
      <AdminNotices error={error} success={success} />

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <AdminCard title="Upload the customer master">
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-muted">
              Upload the DataEdge export <strong className="text-foreground">OutletsList_KDwise_&lt;date&gt;.xlsx</strong>. It <strong className="text-foreground">replaces the whole list</strong>: outlets missing from the new file are removed. Outlets are matched to sales by Outlet_Code
              (the DataEdge customer code). It feeds the Active Outlet module (Upfield DataEdge source: channel, type, route, GPS and the full outlet universe, including outlets that have not bought) and the Upfield DataEdge coverage report (outlets per rep, coverage against the list, channel and type).
            </p>
            <form action={uploadUpfieldOutletMasterAction} className="flex flex-wrap items-center gap-3">
              <input type="file" name="file" accept=".xlsx,.xls" required className="min-w-0 text-sm text-foreground file:mr-4 file:rounded-full file:border-0 file:bg-background-elevated file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-blue hover:file:bg-accent-blue-soft" />
              <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
                Upload as customer master
              </button>
            </form>
          </div>
        </AdminCard>

        {status.total === 0 ? (
          <AdminCard title="Current list">
            <p className="text-sm text-muted">No outlet list uploaded yet. Until one is, the Upfield outlets in the Active Outlet module are only those that appear in the DataEdge sales feed, with no channel, type or route.</p>
          </AdminCard>
        ) : (
          <AdminCard title="Current list">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Outlets in the list", value: fmt(status.total) },
                { label: "Bought, last 90 days", value: `${fmt(status.bought90)} (${Math.round((status.bought90 / status.total) * 100)}%)` },
                { label: "Never in the sales feed", value: fmt(status.neverInSalesFeed) },
                { label: "Buyers not in the list", value: fmt(status.buyersNotInList) },
              ].map((k) => (
                <div key={k.label} className="rounded-xl bg-background-elevated/60 p-3">
                  <div className="text-[12px] text-muted">{k.label}</div>
                  <div className="mt-1 text-lg font-bold text-primary-blue">{k.value}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[13px] text-muted">
              <strong className="text-foreground">{status.sourceFile ?? "unnamed file"}</strong>, uploaded {status.uploadedAt ? new Date(status.uploadedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "—"}
              {status.uploadedBy ? ` by ${status.uploadedBy}` : ""}.
              {status.buyersNotInList > 0
                ? ` ${status.buyersNotInList} customer(s) in the sales feed are not in the list (they are still counted as outlets in the Active Outlet module, without channel or type), e.g. ${status.buyersNotInListExamples.map((b) => `${b.name} (${b.code})`).join(", ")}.`
                : " Every customer in the sales feed is in the list."}
            </p>
          </AdminCard>
        )}
      </div>

      {status.total > 0 ? (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <Breakdown title="By channel" rows={status.byChannel} />
          <Breakdown title="By outlet type" rows={status.byType} />
          <Breakdown title="By route (FSR)" rows={status.byFsr} />
        </div>
      ) : null}
    </AdminPage>
  );
}
