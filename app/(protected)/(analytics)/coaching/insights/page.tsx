import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { coachingScopeForUser, loadCoachingSnapshot } from "@/lib/coachingBridge";
import { STATUS_LABELS, countBy, dailyCounts, groupRows, isOverdue, kpis, scoreBuckets, type Count, type GroupRow } from "@/lib/coachingModules";

// The Coaching app's own admin dashboard, module by module (Overview, Team Leaders & Reps, Routes, Action Plans, Accompaniments, Photos), from the snapshot the
// Coaching app pushes every 15 minutes. Same scope, dates and principal filter as the Workspace and Reporting pages.

type SearchParams = { from?: string; to?: string; principal?: string; tab?: string; tl?: string; rep?: string; status?: string; page?: string };

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "Team Leaders & Reps" },
  { id: "routes", label: "Routes" },
  { id: "actions", label: "Action Plans" },
  { id: "records", label: "Accompaniments" },
  { id: "photos", label: "Photos" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const PHOTOS_PER_PAGE = 60;
const validDate = (value: string | undefined, fallback: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback);
const shortDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
const label = (value: string) => STATUS_LABELS[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
const show = (v: number | null, suffix = "") => (v === null ? "—" : `${v}${suffix}`);

const card = "rounded-2xl border border-border bg-surface p-5 shadow-sm";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted";
const td = "px-3 py-2 text-sm text-foreground";

function Bars({ data, suffix = "", empty = "No data in this period.", max: fixedMax }: { data: Count[]; suffix?: string; empty?: string; max?: number }) {
  if (data.length === 0) return <p className="py-6 text-sm text-muted">{empty}</p>;
  const max = fixedMax ?? Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-muted" title={d.label}>{d.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-background-elevated"><div className="h-full rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} /></div>
          <span className="w-16 shrink-0 text-right font-semibold text-foreground">{d.value}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

function Kpi({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </article>
  );
}

function SummaryTable({ rows, nameHeader }: { rows: GroupRow[]; nameHeader: string }) {
  if (rows.length === 0) return <p className="py-6 text-sm text-muted">No records in this period.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse">
        <thead className="bg-accent-blue-soft/50"><tr><th className={th}>{nameHeader}</th><th className={th}>Accompaniments</th><th className={th}>Outlet visits</th><th className={th}>Outlets</th><th className={th}>Avg score</th><th className={th}>Approved</th><th className={th}>Feedback</th><th className={th}>Geofence</th><th className={th}>Min at outlet</th></tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.name}><td className={`${td} font-medium`}>{r.name}</td><td className={td}>{r.accompaniments}</td><td className={td}>{r.visits}</td><td className={td}>{r.outlets}</td><td className={td}>{show(r.avgScore, "%")}</td><td className={td}>{r.approvedPct}%</td><td className={td}>{r.feedbackPct}%</td><td className={td}>{show(r.geofencePct, "%")}</td><td className={td}>{show(r.avgMinutesAtOutlet)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function CoachingInsightsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "TEAM_LEADER", "SUPERVISOR"].includes(session.user.role)) redirect("/dashboard");
  const scope = await coachingScopeForUser(session.user);
  if (!scope) redirect("/dashboard");
  const q = await searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
  const from = validDate(q.from, `${today.slice(0, 8)}01`);
  const to = validDate(q.to, today);
  const tab: TabId = (TABS.find((t) => t.id === q.tab)?.id ?? "overview") as TabId;
  const snapshot = await loadCoachingSnapshot(scope, { from, to, principal: q.principal });
  const k = kpis(snapshot, today);

  const base = new URLSearchParams({ from, to });
  if (q.principal) base.set("principal", q.principal);
  const hrefFor = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(base);
    for (const [key, value] of Object.entries(extra)) if (value) p.set(key, value);
    return `/coaching/insights?${p.toString()}`;
  };

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <section className={`${card} md:p-6`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-blue">Field execution</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Coaching & Accompaniment</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">The Coaching app&apos;s dashboard, module by module, for the teams you can see.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-full bg-accent-blue-soft p-1 text-sm font-semibold sm:flex">
              <Link href={`/coaching?${base.toString()}`} className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Workspace</Link>
              <span className="rounded-full bg-surface px-4 py-2 text-primary-blue shadow-sm">Modules</span>
              <Link href={`/coaching/reports?${base.toString()}`} className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Reporting</Link>
            </div>
            <p className="text-xs text-muted">Synced {new Date(snapshot.generatedAt).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
        <form className="mt-5 grid gap-3 rounded-xl bg-accent-blue-soft/40 p-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <input type="hidden" name="tab" value={tab} />
          <label className="text-xs font-medium text-muted">From<input name="from" type="date" defaultValue={from} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" /></label>
          <label className="text-xs font-medium text-muted">To<input name="to" type="date" defaultValue={to} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" /></label>
          <label className="text-xs font-medium text-muted">Principal<select name="principal" defaultValue={q.principal ?? ""} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"><option value="">All principals</option>{snapshot.principals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <div className="flex items-end"><button className="w-full rounded-lg bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-sm font-semibold text-white shadow-cyan-glow">Apply filters</button></div>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Kpi title="Accompaniments" value={String(k.accompaniments)} detail={k.visitations ? `+ ${k.visitations} outlet visitation(s)` : undefined} />
        <Kpi title="Outlet visits" value={String(k.outletVisits)} detail={`${k.uniqueOutlets} unique outlets`} />
        <Kpi title="Avg coaching score" value={show(k.avgScore, "%")} />
        <Kpi title="Approved" value={`${k.approvedPct}%`} detail="of submitted work" />
        <Kpi title="Geofence" value={show(k.geofencePct, "%")} detail="visits inside the outlet fence" />
        <Kpi title="Action closure" value={`${k.actionClosurePct}%`} detail={`${snapshot.actions.length} action(s)`} />
        <Kpi title="Overdue actions" value={String(k.overdueActions)} />
        <Kpi title="Photos" value={String(snapshot.photos.length)} />
      </section>

      <nav className="flex flex-wrap gap-1.5 border-b-2 border-border">
        {TABS.map((t) => (
          <Link key={t.id} href={hrefFor({ tab: t.id })} className={`-mb-0.5 border-b-[3px] px-4 py-2.5 text-sm font-semibold ${tab === t.id ? "border-primary-blue text-primary-blue" : "border-transparent text-muted hover:text-primary-blue"}`}>{t.label}</Link>
        ))}
      </nav>

      {tab === "overview" ? <Overview snapshot={snapshot} /> : null}
      {tab === "people" ? <People snapshot={snapshot} /> : null}
      {tab === "routes" ? <Routes snapshot={snapshot} /> : null}
      {tab === "actions" ? <Actions snapshot={snapshot} today={today} /> : null}
      {tab === "records" ? <Records snapshot={snapshot} q={q} hrefFor={hrefFor} /> : null}
      {tab === "photos" ? <Photos snapshot={snapshot} page={Math.max(1, Number(q.page) || 1)} hrefFor={hrefFor} /> : null}
    </div>
  );
}

type Snap = Awaited<ReturnType<typeof loadCoachingSnapshot>>;

function Overview({ snapshot }: { snapshot: Snap }) {
  const daily = dailyCounts(snapshot.accompaniments).map((d) => ({ ...d, label: shortDate(d.label) }));
  return (
    <section className="grid gap-4 xl:grid-cols-2">
      <article className={card}><h2 className="font-semibold text-foreground">Accompaniments logged by day</h2><div className="mt-4"><Bars data={daily} /></div></article>
      <article className={card}><h2 className="font-semibold text-foreground">Coaching score distribution</h2><div className="mt-4"><Bars data={scoreBuckets(snapshot.accompaniments)} empty="No scored accompaniments." /></div></article>
      <article className={card}><h2 className="font-semibold text-foreground">Approval status</h2><div className="mt-4"><Bars data={countBy(snapshot.accompaniments, (a) => label(a.status))} /></div></article>
      <article className={card}><h2 className="font-semibold text-foreground">Action plan status</h2><div className="mt-4"><Bars data={countBy(snapshot.actions, (a) => label(a.status))} empty="No action plans." /></div></article>
      <article className={card}><h2 className="font-semibold text-foreground">Outlets visited by principal</h2><div className="mt-4"><Bars data={countBy(snapshot.visits, (v) => v.visitPrincipal || v.principalName)} /></div></article>
      <article className={card}><h2 className="font-semibold text-foreground">Coaching gaps (action plan areas)</h2><div className="mt-4"><Bars data={countBy(snapshot.actions, (a) => a.coaching_area ?? "General")} empty="No action plans." /></div></article>
    </section>
  );
}

function People({ snapshot }: { snapshot: Snap }) {
  const leaders = groupRows(snapshot, (a) => a.teamLeaderName);
  const reps = groupRows({ ...snapshot, accompaniments: snapshot.accompaniments.filter((a) => a.activityType !== "outlet_visitation") }, (a) => a.salesRepName);
  return (
    <>
      <section className="grid gap-4 xl:grid-cols-2">
        <article className={card}><h2 className="font-semibold text-foreground">Avg coaching score by team leader</h2><div className="mt-4"><Bars data={leaders.filter((r) => r.avgScore !== null).map((r) => ({ label: r.name, value: r.avgScore as number }))} suffix="%" max={100} /></div></article>
        <article className={card}><h2 className="font-semibold text-foreground">Accompaniments by team leader</h2><div className="mt-4"><Bars data={leaders.map((r) => ({ label: r.name, value: r.accompaniments }))} /></div></article>
      </section>
      <article className={card}><h2 className="mb-3 font-semibold text-foreground">Team leader performance summary</h2><SummaryTable rows={leaders} nameHeader="Team leader" /></article>
      <article className={card}><h2 className="mb-3 font-semibold text-foreground">Sales rep performance summary</h2><SummaryTable rows={reps} nameHeader="Sales rep" /></article>
    </>
  );
}

function Routes({ snapshot }: { snapshot: Snap }) {
  const routes = groupRows(snapshot, (a) => a.routeName ?? "No route");
  return (
    <>
      <section className="grid gap-4 xl:grid-cols-2">
        <article className={card}><h2 className="font-semibold text-foreground">Avg coaching score by route</h2><div className="mt-4"><Bars data={routes.filter((r) => r.avgScore !== null).map((r) => ({ label: r.name, value: r.avgScore as number }))} suffix="%" max={100} /></div></article>
        <article className={card}><h2 className="font-semibold text-foreground">Geofence compliance by route</h2><div className="mt-4"><Bars data={routes.filter((r) => r.geofencePct !== null).map((r) => ({ label: r.name, value: r.geofencePct as number }))} suffix="%" max={100} /></div></article>
      </section>
      <article className={card}><h2 className="mb-3 font-semibold text-foreground">Route performance summary</h2><SummaryTable rows={routes} nameHeader="Route" /></article>
    </>
  );
}

function Actions({ snapshot, today }: { snapshot: Snap; today: string }) {
  const byAcc = new Map(snapshot.accompaniments.map((a) => [a.id, a]));
  const rows = [...snapshot.actions].sort((a, b) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999"));
  const overdue = rows.filter((a) => isOverdue(a, today)).length;
  return (
    <article className={card}>
      <h2 className="font-semibold text-foreground">All action plan items ({rows.length}{overdue ? `, ${overdue} overdue` : ""})</h2>
      {rows.length === 0 ? <p className="py-6 text-sm text-muted">No action plans in this period.</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse">
            <thead className="bg-accent-blue-soft/50"><tr><th className={th}>Date</th><th className={th}>Team leader</th><th className={th}>Owner</th><th className={th}>Issue</th><th className={th}>Required action</th><th className={th}>Area</th><th className={th}>Priority</th><th className={th}>Status</th><th className={th}>Target</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => {
                const parent = byAcc.get(a.accompaniment_id);
                const late = isOverdue(a, today);
                return (
                  <tr key={a.id} className={late ? "bg-red-50/60" : undefined}>
                    <td className={td}>{parent ? shortDate(parent.date) : "—"}</td><td className={td}>{parent?.teamLeaderName ?? "—"}</td><td className={td}>{a.ownerName ?? parent?.salesRepName ?? "—"}</td>
                    <td className={td}>{a.issue}</td><td className={td}>{a.required_action ?? "—"}</td><td className={td}>{a.coaching_area ?? "General"}</td><td className={td}>{label(a.priority)}</td>
                    <td className={td}>{late ? "Overdue" : label(a.status)}</td><td className={td}>{a.target_date ? shortDate(a.target_date) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function Records({ snapshot, q, hrefFor }: { snapshot: Snap; q: SearchParams; hrefFor: (extra: Record<string, string | undefined>) => string }) {
  const visitsByAcc = new Map<string, number>();
  for (const v of snapshot.visits) visitsByAcc.set(v.accompaniment_id, (visitsByAcc.get(v.accompaniment_id) ?? 0) + 1);
  const leaders = [...new Set(snapshot.accompaniments.map((a) => a.teamLeaderName))].sort();
  const reps = [...new Set(snapshot.accompaniments.map((a) => a.salesRepName))].sort();
  const rows = snapshot.accompaniments.filter((a) => (!q.tl || a.teamLeaderName === q.tl) && (!q.rep || a.salesRepName === q.rep) && (!q.status || a.status === q.status));
  return (
    <article className={card}>
      <form method="get" action="/coaching/insights" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="records" />
        {(["from", "to", "principal"] as const).map((key) => (q[key] ? <input key={key} type="hidden" name={key} value={q[key]} /> : null))}
        <select name="tl" defaultValue={q.tl ?? ""} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="">All team leaders</option>{leaders.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <select name="rep" defaultValue={q.rep ?? ""} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="">All sales reps</option>{reps.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <select name="status" defaultValue={q.status ?? ""} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"><option value="">Every status</option>{Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <button className="rounded-lg bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-sm font-semibold text-white">Filter</button>
        {q.tl || q.rep || q.status ? <Link href={hrefFor({ tab: "records" })} className="px-2 py-2 text-sm text-primary-blue">Clear</Link> : null}
        <span className="ml-auto text-sm text-muted">{rows.length} record(s)</span>
      </form>
      {rows.length === 0 ? <p className="py-6 text-sm text-muted">No records match.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead className="bg-accent-blue-soft/50"><tr><th className={th}>Date</th><th className={th}>Team leader</th><th className={th}>Sales rep</th><th className={th}>Route</th><th className={th}>Type</th><th className={th}>Outlet visits</th><th className={th}>Score</th><th className={th}>Status</th><th className={th}>Supervisor feedback</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{shortDate(a.date)}</td><td className={td}>{a.teamLeaderName}</td><td className={td}>{a.activityType === "outlet_visitation" ? "—" : a.salesRepName}</td><td className={td}>{a.routeName ?? "—"}</td>
                  <td className={td}>{a.activityType === "outlet_visitation" ? "Outlet visitation" : "Accompaniment"}</td><td className={td}>{visitsByAcc.get(a.id) ?? 0}</td><td className={td}>{show(a.overall_score, "%")}</td><td className={td}>{label(a.status)}</td>
                  <td className={`${td} max-w-xs truncate`} title={a.supervisor_comments ?? ""}>{a.supervisor_comments ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}

function Photos({ snapshot, page, hrefFor }: { snapshot: Snap; page: number; hrefFor: (extra: Record<string, string | undefined>) => string }) {
  const byAcc = new Map(snapshot.accompaniments.map((a) => [a.id, a]));
  const photos = [...snapshot.photos].sort((a, b) => (b.takenAt ?? b.date).localeCompare(a.takenAt ?? a.date));
  const pages = Math.max(1, Math.ceil(photos.length / PHOTOS_PER_PAGE));
  const shown = photos.slice((Math.min(page, pages) - 1) * PHOTOS_PER_PAGE, Math.min(page, pages) * PHOTOS_PER_PAGE);
  return (
    <article className={card}>
      <h2 className="font-semibold text-foreground">Visit photos ({photos.length})</h2>
      {photos.length === 0 ? <p className="py-6 text-sm text-muted">No visit photos in this period.</p> : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {shown.map((p) => {
              const parent = byAcc.get(p.accompaniment_id);
              return (
                <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer" className="group block">
                  <div className="aspect-square overflow-hidden rounded-lg border border-border bg-background-elevated">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Visit photo at ${p.outletName}`} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                  </div>
                  <p className="mt-1.5 truncate text-xs font-medium text-foreground">{p.outletName}</p>
                  <p className="truncate text-[11px] text-muted">{parent ? `${parent.salesRepName} · ` : ""}{p.date ? shortDate(p.date) : ""}</p>
                  {p.latitude !== null && p.longitude !== null ? <p className="truncate text-[11px] text-primary-blue">📍 {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}</p> : <p className="text-[11px] text-muted">No GPS captured</p>}
                </a>
              );
            })}
          </div>
          {pages > 1 ? (
            <div className="mt-5 flex items-center justify-center gap-3 text-sm">
              {page > 1 ? <Link href={hrefFor({ tab: "photos", page: String(page - 1) })} className="rounded-lg border border-border px-3 py-1.5 text-primary-blue">‹ Newer</Link> : null}
              <span className="text-muted">Page {Math.min(page, pages)} of {pages}</span>
              {page < pages ? <Link href={hrefFor({ tab: "photos", page: String(page + 1) })} className="rounded-lg border border-border px-3 py-1.5 text-primary-blue">Older ›</Link> : null}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
