import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { monthLabel } from "@/lib/coachingRepSalesExcel";
import { currentMonth, loadRepSales } from "@/lib/coachingRepSalesQuery";
import { monthBefore } from "@/lib/coachingRepSales";

type SearchParams = { month?: string; leader?: string; principal?: string; rep?: string; q?: string; show?: string };

const OUTLET_LIMIT = 500;
const n = (value: number) => value.toLocaleString("en-KE");
const money = (value: number) => value.toLocaleString("en-KE", { maximumFractionDigits: 0 });
const SHOW = [
  { key: "", label: "All outlets" },
  { key: "Not visited", label: "Not visited" },
  { key: "Visited, no sale", label: "Visited, no sale" },
  { key: "Bought", label: "Bought" },
];
const field = "mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground";
const th = "px-3 py-2 font-semibold";
const num = "px-3 py-2 text-right tabular-nums";

export default async function RepSalesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (!session?.user) redirect("/dashboard");
  const supplied = await searchParams;
  const result = await loadRepSales(session.user, supplied);
  if (!result) redirect("/dashboard");
  const { report, filters, builtAt } = result;

  const query = (extra: Record<string, string | undefined>) => {
    const values = { month: filters.month, leader: filters.teamLeader, principal: filters.principal, rep: filters.repCode, q: filters.search, show: supplied.show, ...extra };
    return new URLSearchParams(Object.entries(values).filter((e): e is [string, string] => !!e[1])).toString();
  };
  const latest = currentMonth();
  const months = Array.from({ length: Number(latest.slice(5, 7)) }, (_, i) => monthBefore(latest, i));
  const total = (pick: (r: (typeof report.reps)[number]) => number) => report.reps.reduce((sum, r) => sum + pick(r), 0);
  const cards = [
    { label: `Sales ${monthLabel(filters.month)}`, value: money(total((r) => r.salesThisMonth)), detail: `${money(total((r) => r.salesLastMonth))} the month before` },
    { label: "Outlets bought", value: n(total((r) => r.boughtThisMonth)), detail: `of ${n(total((r) => r.outlets))} outlets (${n(total((r) => r.buyingOutlets))} buying)` },
    { label: "Outlets visited", value: n(total((r) => r.outletsVisited)), detail: `${n(total((r) => r.calls))} calls` },
    { label: "Visited, no sale", value: n(total((r) => r.visitedNoSale)), detail: "called on, nothing sold" },
    { label: "Not visited", value: n(total((r) => r.notVisited)), detail: "no call and no sale" },
  ];

  // The outlet list is shown once a single rep is chosen; the Excel extract always has every outlet.
  const rep = filters.repCode ? report.reps[0] : undefined;
  const shown = rep ? report.outlets.filter((o) => !supplied.show || o.visit === supplied.show) : [];

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-blue">Field execution</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Rep sales</h1>
            <p className="mt-2 text-sm text-muted">
              Sales, visits and outlets per rep, as the Coaching app shows them.
              {builtAt ? ` Data built ${new Date(builtAt).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" })}.` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-full bg-accent-blue-soft p-1 text-sm font-semibold">
              <Link href="/coaching" className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Workspace</Link>
              <Link href="/coaching/insights" className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Modules</Link>
              <Link href="/coaching/reports" className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Reporting</Link>
              <span className="rounded-full bg-surface px-4 py-2 text-primary-blue shadow-sm">Rep sales</span>
            </div>
            <a href={`/api/coaching/rep-sales?${query({ download: "summary", show: undefined })}`} className="rounded-full border border-primary-blue px-4 py-2 text-sm font-semibold text-primary-blue hover:bg-accent-blue-soft">⬇ Excel: rep summary</a>
            <a href={`/api/coaching/rep-sales?${query({ download: "outlets", show: undefined })}`} className="rounded-full border border-primary-blue px-4 py-2 text-sm font-semibold text-primary-blue hover:bg-accent-blue-soft">⬇ Excel: outlet detail</a>
          </div>
        </div>
        <form className="mt-5 grid gap-3 rounded-xl bg-accent-blue-soft/40 p-3 sm:grid-cols-2 lg:grid-cols-5" method="get">
          <label className="text-xs font-medium text-muted">Month
            <select name="month" defaultValue={filters.month} className={field}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-muted">Team leader
            <select name="leader" defaultValue={filters.teamLeader ?? ""} className={field}><option value="">All team leaders</option>{report.teamLeaders.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-muted">Principal
            <select name="principal" defaultValue={filters.principal ?? ""} className={field}><option value="">All principals</option>{report.principals.map((name) => <option key={name} value={name}>{name}</option>)}</select>
          </label>
          <label className="text-xs font-medium text-muted">Rep name or code
            <input name="q" defaultValue={filters.search ?? ""} placeholder="Search" className={field} />
          </label>
          <div className="flex items-end"><button className="w-full rounded-lg bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-sm font-semibold text-white shadow-cyan-glow">Apply filters</button></div>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => (
          <article key={card.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{card.label}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{card.value}</p>
            <p className="mt-1 text-xs text-muted">{card.detail}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-semibold text-foreground">{rep ? `${rep.rep} (${rep.repCode})` : "Reps"}</h2>
            <p className="mt-1 text-xs text-muted">{rep ? `Team leader ${rep.teamLeader} · ${rep.principals}` : "Choose a rep to see their outlets."}</p>
          </div>
          {rep ? <Link href={`/coaching/rep-sales?${query({ rep: undefined, show: undefined })}`} className="text-sm font-semibold text-primary-blue">← All reps</Link> : null}
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 bg-accent-blue-soft text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className={th}>Team leader</th><th className={th}>Rep</th><th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>Month before</th>
                <th className={`${th} text-right`}>Outlets</th><th className={`${th} text-right`}>Bought</th><th className={`${th} text-right`}>Visited</th>
                <th className={`${th} text-right`}>No sale</th><th className={`${th} text-right`}>Not visited</th><th className={`${th} text-right`}>Calls</th><th className={`${th} text-right`}>Strike rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.reps.map((r) => (
                <tr key={r.repCode} className="hover:bg-accent-blue-soft/30">
                  <td className="px-3 py-2 text-muted">{r.teamLeader}</td>
                  <td className="px-3 py-2"><Link href={`/coaching/rep-sales?${query({ rep: r.repCode, show: undefined })}`} className="font-semibold text-primary-blue">{r.rep}</Link> <span className="text-xs text-muted">{r.repCode}</span></td>
                  <td className={`${num} font-semibold`}>{money(r.salesThisMonth)}</td><td className={num}>{money(r.salesLastMonth)}</td><td className={num}>{n(r.outlets)}</td>
                  <td className={num}>{n(r.boughtThisMonth)}</td><td className={num}>{n(r.outletsVisited)}</td><td className={num}>{n(r.visitedNoSale)}</td><td className={num}>{n(r.notVisited)}</td>
                  <td className={num}>{n(r.calls)}</td><td className={num}>{r.strikeRatePct === null ? "—" : `${r.strikeRatePct}%`}</td>
                </tr>
              ))}
              {report.reps.length === 0 ? <tr><td colSpan={11} className="px-3 py-8 text-center text-muted">No reps match these filters.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {rep ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 className="font-semibold text-foreground">Outlets in {monthLabel(filters.month)} ({n(shown.length)})</h2>
            <div className="flex flex-wrap gap-1 rounded-full bg-accent-blue-soft p-1 text-xs font-semibold">
              {SHOW.map((s) => (
                <Link key={s.label} href={`/coaching/rep-sales?${query({ show: s.key || undefined })}`} className={`rounded-full px-3 py-1.5 ${(supplied.show ?? "") === s.key ? "bg-surface text-primary-blue shadow-sm" : "text-muted"}`}>{s.label}</Link>
              ))}
            </div>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-accent-blue-soft text-xs uppercase tracking-wide text-muted">
                <tr><th className={th}>Outlet</th><th className={th}>Principal</th><th className={th}>Territory</th><th className={th}>This month</th><th className={`${th} text-right`}>Sales</th><th className={`${th} text-right`}>Month before</th><th className={`${th} text-right`}>Calls</th><th className={th}>Last purchase</th><th className={th}>Status</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.slice(0, OUTLET_LIMIT).map((o) => (
                  <tr key={`${o.principal}-${o.outletId}`}>
                    <td className="px-3 py-2"><span className="font-medium text-foreground">{o.outlet}</span> <span className="text-xs text-muted">{o.outletId}</span></td>
                    <td className="px-3 py-2">{o.principal}</td><td className="px-3 py-2">{o.territory || "—"}</td><td className="px-3 py-2">{o.visit}</td>
                    <td className={num}>{money(o.salesThisMonth)}</td><td className={num}>{money(o.salesLastMonth)}</td><td className={num}>{n(o.calls)}</td>
                    <td className="px-3 py-2">{o.lastPurchase ?? "—"}</td><td className="px-3 py-2">{o.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.length > OUTLET_LIMIT ? <p className="border-t border-border px-5 py-3 text-xs text-muted">Showing the first {n(OUTLET_LIMIT)}. The Excel outlet detail has all of them.</p> : null}
        </section>
      ) : null}
    </div>
  );
}
