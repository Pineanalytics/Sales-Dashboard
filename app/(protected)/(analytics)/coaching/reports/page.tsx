import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { coachingScopeForUser, loadCoachingSnapshot } from "@/lib/coachingBridge";

type SearchParams = { from?: string; to?: string; principal?: string };
const closedActions = new Set(["completed", "verified", "closed"]);

function validDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function BarRows({ data, valueSuffix = "", empty = "No data in this period." }: { data: { label: string; value: number; sub?: string }[]; valueSuffix?: string; empty?: string }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  if (data.length === 0) return <p className="py-8 text-sm text-muted">{empty}</p>;
  return <div className="space-y-3">{data.slice(0, 8).map((item) => <div key={item.label}><div className="mb-1 flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium text-foreground">{item.label}</span><span className="shrink-0 font-semibold text-primary-blue">{item.value}{valueSuffix}</span></div><div className="h-2 overflow-hidden rounded-full bg-accent-blue-soft"><div className="h-full rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue" style={{ width: `${Math.max((item.value / max) * 100, item.value > 0 ? 4 : 0)}%` }} /></div>{item.sub ? <p className="mt-1 text-xs text-muted">{item.sub}</p> : null}</div>)}</div>;
}

export default async function CoachingReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "TEAM_LEADER", "SUPERVISOR"].includes(session.user.role)) redirect("/dashboard");
  const scope = await coachingScopeForUser(session.user);
  if (!scope) redirect("/dashboard");
  const supplied = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = validDate(supplied.from, `${today.slice(0, 8)}01`);
  const to = validDate(supplied.to, today);
  const snapshot = await loadCoachingSnapshot(scope, { from, to, principal: supplied.principal });
  const submitted = snapshot.accompaniments.filter((item) => item.status !== "draft");
  const approved = snapshot.accompaniments.filter((item) => item.status === "approved");
  const uniqueOutlets = new Set(snapshot.visits.map((visit) => visit.outlet_id)).size;
  const plannedVisits = snapshot.visits.filter((visit) => visit.planned).length;
  const insideGeofence = snapshot.visits.filter((visit) => visit.geofence_status === "inside").length;
  const todayString = new Date().toISOString().slice(0, 10);
  const openActions = snapshot.actions.filter((action) => !closedActions.has(action.status));
  const overdueActions = openActions.filter((action) => action.target_date && action.target_date < todayString);

  const byLeader = new Map<string, { accompaniments: number; approved: number; feedback: number; scores: number[]; outlets: Set<string> }>();
  for (const item of snapshot.accompaniments) {
    const row = byLeader.get(item.teamLeaderName) ?? { accompaniments: 0, approved: 0, feedback: 0, scores: [], outlets: new Set<string>() };
    row.accompaniments++;
    if (item.status === "approved") row.approved++;
    if (item.supervisor_comments?.trim()) row.feedback++;
    if (item.overall_score !== null) row.scores.push(item.overall_score);
    byLeader.set(item.teamLeaderName, row);
  }
  const leaderRows = [...byLeader.entries()].map(([label, row]) => ({ label, value: row.accompaniments, sub: `${percent(row.approved, row.accompaniments)}% approved · ${percent(row.feedback, row.accompaniments)}% feedback` })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const leaderScoreRows = [...byLeader.entries()].filter(([, row]) => row.scores.length).map(([label, row]) => ({ label, value: Math.round((row.scores.reduce((sum, score) => sum + score, 0) / row.scores.length) * 10) / 10, sub: `${row.scores.length} scored accompaniment(s)` })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const byPrincipal = new Map<string, Set<string>>();
  for (const visit of snapshot.visits) {
    const outlets = byPrincipal.get(visit.principalName) ?? new Set<string>();
    outlets.add(visit.outlet_id);
    byPrincipal.set(visit.principalName, outlets);
  }
  const principalRows = [...byPrincipal.entries()].map(([label, outlets]) => ({ label, value: outlets.size, sub: "unique outlets accompanied" })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const gaps = new Map<string, number>();
  for (const action of snapshot.actions) gaps.set(action.coaching_area ?? "General", (gaps.get(action.coaching_area ?? "General") ?? 0) + 1);
  const gapRows = [...gaps.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const cards = [
    { label: "Approval attainment", value: `${percent(approved.length, submitted.length)}%`, detail: `${approved.length} approved from ${submitted.length} submitted` },
    { label: "Outlet coverage", value: uniqueOutlets, detail: `${snapshot.visits.length} total outlet visit(s)` },
    { label: "Journey-plan adherence", value: `${percent(plannedVisits, snapshot.visits.length)}%`, detail: `${plannedVisits} planned field visit(s)` },
    { label: "Geofence confidence", value: `${percent(insideGeofence, snapshot.visits.filter((visit) => visit.geofence_status !== null).length)}%`, detail: `${insideGeofence} verified inside geofence` },
    { label: "Open actions", value: openActions.length, detail: `${overdueActions.length} overdue action(s)` },
  ];

  const filterHref = (path: string) => `${path}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${supplied.principal ? `&principal=${encodeURIComponent(supplied.principal)}` : ""}`;
  return <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm md:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-blue">Field execution</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Coaching reporting</h1><p className="mt-2 text-sm text-muted">Performance, quality and follow-through by leader, principal and outlet.</p></div><div className="flex rounded-full bg-accent-blue-soft p-1 text-sm font-semibold"><Link href={filterHref("/coaching")} className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Workspace</Link><span className="rounded-full bg-surface px-4 py-2 text-primary-blue shadow-sm">Reporting</span></div></div><form className="mt-5 grid gap-3 rounded-xl bg-accent-blue-soft/40 p-3 sm:grid-cols-2 lg:grid-cols-4" method="get"><label className="text-xs font-medium text-muted">From<input name="from" type="date" defaultValue={from} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" /></label><label className="text-xs font-medium text-muted">To<input name="to" type="date" defaultValue={to} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" /></label><label className="text-xs font-medium text-muted">Principal<select name="principal" defaultValue={supplied.principal ?? ""} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"><option value="">All principals</option>{snapshot.principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.name}</option>)}</select></label><div className="flex items-end"><button className="w-full rounded-lg bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-sm font-semibold text-white shadow-cyan-glow">Apply filters</button></div></form></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map((card) => <article key={card.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{card.label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{card.value}</p><p className="mt-1 text-xs text-muted">{card.detail}</p></article>)}</section>
    <section className="grid gap-4 xl:grid-cols-2"><article className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><h2 className="font-semibold text-foreground">Coaching activity by Team Leader</h2><p className="mt-1 text-xs text-muted">Approval and feedback attainment alongside activity volume.</p><div className="mt-5"><BarRows data={leaderRows} /></div></article><article className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><h2 className="font-semibold text-foreground">Coaching quality by Team Leader</h2><p className="mt-1 text-xs text-muted">Average score from completed scored accompaniments.</p><div className="mt-5"><BarRows data={leaderScoreRows} valueSuffix="%" empty="No scored accompaniments in this period." /></div></article><article className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><h2 className="font-semibold text-foreground">Outlet coverage by principal</h2><p className="mt-1 text-xs text-muted">Unique outlets accompanied, not the number of repeated visits.</p><div className="mt-5"><BarRows data={principalRows} /></div></article><article className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><h2 className="font-semibold text-foreground">Coaching gaps by area</h2><p className="mt-1 text-xs text-muted">Action-plan issues raised from field observations.</p><div className="mt-5"><BarRows data={gapRows} /></div></article></section>
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold text-foreground">Accompaniment record detail</h2><p className="mt-1 text-xs text-muted">The most recent live records in the selected scope.</p></div><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-accent-blue-soft/40 text-xs uppercase tracking-wide text-muted"><tr><th className="px-5 py-3 font-semibold">Date</th><th className="px-5 py-3 font-semibold">Team Leader</th><th className="px-5 py-3 font-semibold">Sales Rep</th><th className="px-5 py-3 font-semibold">Status</th><th className="px-5 py-3 font-semibold">Score</th><th className="px-5 py-3 font-semibold">Feedback</th></tr></thead><tbody className="divide-y divide-border">{snapshot.accompaniments.slice(0, 50).map((item) => <tr key={item.id} className="hover:bg-accent-blue-soft/20"><td className="whitespace-nowrap px-5 py-3 text-muted">{displayDate(item.date)}</td><td className="px-5 py-3 font-medium text-foreground">{item.teamLeaderName}</td><td className="px-5 py-3 text-foreground">{item.salesRepName}</td><td className="px-5 py-3"><span className="rounded-full border border-border px-2 py-1 text-xs font-semibold text-muted">{statusLabel(item.status)}</span></td><td className="px-5 py-3 font-semibold text-primary-blue">{item.overall_score === null ? "—" : `${item.overall_score}%`}</td><td className="max-w-72 truncate px-5 py-3 text-muted" title={item.supervisor_comments ?? ""}>{item.supervisor_comments?.trim() || "—"}</td></tr>)}{snapshot.accompaniments.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">No Coaching records match these filters.</td></tr> : null}</tbody></table></div></section>
  </div>;
}
