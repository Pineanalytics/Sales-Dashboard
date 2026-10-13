import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUpfieldOutletMasterStatus } from "@/lib/upfieldOutletMasterStore";
import { uploadUpfieldOutletMasterAction } from "./actions";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("en-KE");

function Breakdown({ title, rows }: { title: string; rows: { name: string; outlets: number; bought: number }[] }) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <h2 className="text-base font-semibold text-primary-blue">{title}</h2>
      <table className="mt-3 w-full text-sm">
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
  );
}

export default async function AdminUpfieldOutletsPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") redirect("/");
  const { error, success } = await searchParams;
  const status = await getUpfieldOutletMasterStatus();

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Upfield outlet list</h1>
        <p className="mt-1 text-sm text-white/70">Upfield&apos;s official customer master: every outlet with its type, channel, route and GPS point.</p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        {error ? <p className="rounded-xl border-l-4 border-l-accent-red bg-surface px-4 py-3 text-sm text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{error}</p> : null}
        {success ? <p className="rounded-xl border-l-4 border-l-accent-green bg-surface px-4 py-3 text-sm text-accent-green shadow-[0_1px_3px_rgba(0,0,0,0.08)]">{success}</p> : null}

        <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col gap-3">
          <p className="text-[13px] text-muted">
            Upload the DataEdge export <strong className="text-foreground">OutletsList_KDwise_&lt;date&gt;.xlsx</strong>. It <strong className="text-foreground">replaces the whole list</strong>: outlets missing from the new file are removed. Outlets are matched to sales by Outlet_Code
            (the DataEdge customer code). It feeds the Active Outlet module (Upfield DataEdge source: channel, type, route, GPS and the full outlet universe, including outlets that have not bought) and the Upfield DataEdge coverage report (outlets per rep, coverage against the list, channel and type).
          </p>
          <form action={uploadUpfieldOutletMasterAction} className="flex flex-wrap items-center gap-3">
            <input type="file" name="file" accept=".xlsx,.xls" required className="text-sm" />
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow">
              Upload as customer master
            </button>
          </form>
        </div>

        {status.total === 0 ? (
          <p className="rounded-2xl bg-surface p-6 text-sm text-muted shadow-[0_1px_3px_rgba(0,0,0,0.08)]">No outlet list uploaded yet. Until one is, the Upfield outlets in the Active Outlet module are only those that appear in the DataEdge sales feed, with no channel, type or route.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Outlets in the list", value: fmt(status.total) },
                { label: "Bought, last 90 days", value: `${fmt(status.bought90)} (${Math.round((status.bought90 / status.total) * 100)}%)` },
                { label: "Never in the sales feed", value: fmt(status.neverInSalesFeed) },
                { label: "Buyers not in the list", value: fmt(status.buyersNotInList) },
              ].map((k) => (
                <div key={k.label} className="rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
                  <div className="text-[13px] text-muted">{k.label}</div>
                  <div className="mt-1 text-xl font-bold text-primary-blue">{k.value}</div>
                </div>
              ))}
            </div>
            <p className="text-[13px] text-muted">
              Current list: <strong className="text-foreground">{status.sourceFile ?? "unnamed file"}</strong>, uploaded {status.uploadedAt ? new Date(status.uploadedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Nairobi" }) : "—"}
              {status.uploadedBy ? ` by ${status.uploadedBy}` : ""}.
              {status.buyersNotInList > 0
                ? ` ${status.buyersNotInList} customer(s) in the sales feed are not in the list (they are still counted as outlets in the Active Outlet module, without channel or type), e.g. ${status.buyersNotInListExamples.map((b) => `${b.name} (${b.code})`).join(", ")}.`
                : " Every customer in the sales feed is in the list."}
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              <Breakdown title="By channel" rows={status.byChannel} />
              <Breakdown title="By outlet type" rows={status.byType} />
            </div>
            <Breakdown title="By route (FSR)" rows={status.byFsr} />
          </>
        )}
      </div>
    </div>
  );
}
