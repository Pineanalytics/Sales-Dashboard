import { auth } from "@/auth";
import { coachingScopeForUser, loadCoachingSnapshot } from "@/lib/coachingBridge";
import { ReviewDecision } from "@/components/coaching/ReviewDecision";
import Link from "next/link";
import { redirect } from "next/navigation";

type SearchParams = { from?: string; to?: string; principal?: string };

const closedActions = new Set(["completed", "verified", "closed"]);
const reviewComplete = new Set(["supervisor_reviewed", "approved"]);

function validDate(value: string | undefined, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

function statusLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function CoachingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "TEAM_LEADER", "SUPERVISOR"].includes(session.user.role)) redirect("/dashboard");
  const scope = await coachingScopeForUser(session.user);
  if (!scope) redirect("/dashboard");
  const supplied = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = validDate(supplied.from, `${today.slice(0, 8)}01`);
  const to = validDate(supplied.to, today);
  const snapshot = await loadCoachingSnapshot(scope, { from, to, principal: supplied.principal });
  const accompaniments = snapshot.accompaniments;
  const submitted = accompaniments.filter((item) => item.status !== "draft");
  const approved = accompaniments.filter((item) => item.status === "approved");
  const awaitingReview = accompaniments.filter((item) => ["submitted", "sales_rep_acknowledged"].includes(item.status));
  const feedback = accompaniments.filter((item) => Boolean(item.supervisor_comments?.trim()));
  const scored = accompaniments.filter((item) => item.overall_score !== null);
  const averageScore = scored.length ? scored.reduce((sum, item) => sum + (item.overall_score ?? 0), 0) / scored.length : null;
  const actions = snapshot.actions;
  const closed = actions.filter((item) => closedActions.has(item.status));
  const isReviewer = session.user.role === "ADMIN" || session.user.role === "SUPERVISOR";
  const visitsByAccompaniment = new Map<string, number>();
  for (const visit of snapshot.visits) visitsByAccompaniment.set(visit.accompaniment_id, (visitsByAccompaniment.get(visit.accompaniment_id) ?? 0) + 1);

  const cards = [
    { label: "Accompaniments", value: accompaniments.length, detail: `${new Set(snapshot.visits.map((visit) => visit.outlet_id)).size} unique outlets` },
    { label: "Approval attainment", value: `${percentage(approved.length, submitted.length)}%`, detail: `${approved.length} of ${submitted.length} submitted` },
    { label: "Feedback recorded", value: `${percentage(feedback.length, submitted.length)}%`, detail: "Reviews with supervisor feedback" },
    { label: "Action closure", value: `${percentage(closed.length, actions.length)}%`, detail: `${actions.length - closed.length} action(s) still open` },
    { label: "Average coaching score", value: averageScore === null ? "—" : `${Math.round(averageScore * 10) / 10}%`, detail: `${scored.length} scored accompaniment(s)` },
    { label: "Awaiting review", value: awaitingReview.length, detail: "Submitted or sales-rep acknowledged" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4">
      <section className="rounded-2xl border border-border bg-surface p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-secondary-blue">Field execution</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground md:text-3xl">Coaching & Accompaniment</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">Live Coaching records, feedback and action follow-through — accessed with your Analytics permissions.</p>
          </div>
          <div className="flex items-center gap-3"><div className="hidden rounded-full bg-accent-blue-soft p-1 text-sm font-semibold sm:flex"><span className="rounded-full bg-surface px-4 py-2 text-primary-blue shadow-sm">Workspace</span><Link href={`/coaching/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${supplied.principal ? `&principal=${encodeURIComponent(supplied.principal)}` : ""}`} className="rounded-full px-4 py-2 text-muted hover:text-primary-blue">Reporting</Link></div><p className="text-xs text-muted">Live source · updated {new Date(snapshot.generatedAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</p></div>
        </div>
        <form className="mt-5 grid gap-3 rounded-xl bg-accent-blue-soft/40 p-3 sm:grid-cols-2 lg:grid-cols-4" method="get">
          <label className="text-xs font-medium text-muted">From<input name="from" type="date" defaultValue={from} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" /></label>
          <label className="text-xs font-medium text-muted">To<input name="to" type="date" defaultValue={to} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground" /></label>
          <label className="text-xs font-medium text-muted">Principal<select name="principal" defaultValue={supplied.principal ?? ""} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground"><option value="">All principals</option>{snapshot.principals.map((principal) => <option key={principal.id} value={principal.id}>{principal.name}</option>)}</select></label>
          <div className="flex items-end"><button className="w-full rounded-lg bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-sm font-semibold text-white shadow-cyan-glow">Apply filters</button></div>
        </form>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => <article key={card.label} className="rounded-xl border border-border bg-surface p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{card.label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{card.value}</p><p className="mt-1 text-xs text-muted">{card.detail}</p></article>)}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold text-foreground">{isReviewer ? "Decision queue" : "Your accompaniment activity"}</h2><p className="mt-1 text-xs text-muted">{isReviewer ? "Review, give feedback or approve the newest records." : "Coaching records in your permitted roster."}</p></div><span className="rounded-full bg-accent-blue-soft px-2.5 py-1 text-xs font-semibold text-primary-blue">{isReviewer ? awaitingReview.length : accompaniments.length}</span></div>
          <div className="divide-y divide-border">
            {(isReviewer ? awaitingReview : accompaniments).slice(0, 12).map((item) => <div key={item.id} className="px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold text-foreground">{item.teamLeaderName} <span className="font-normal text-muted">→</span> {item.salesRepName}</p><p className="mt-1 text-xs text-muted">{displayDate(item.date)} · {visitsByAccompaniment.get(item.id) ?? 0} outlet visit(s) · {item.overall_score === null ? "Not scored" : `${item.overall_score}% score`}</p></div><span className="rounded-full border border-border px-2 py-1 text-[11px] font-semibold text-muted">{statusLabel(item.status)}</span></div>{isReviewer ? <ReviewDecision accompanimentId={item.id} existingComments={item.supervisor_comments} /> : item.supervisor_comments ? <p className="mt-2 rounded-lg bg-accent-blue-soft/50 px-3 py-2 text-xs text-muted"><span className="font-semibold text-primary-blue">Supervisor feedback:</span> {item.supervisor_comments}</p> : null}</div>)}
            {(isReviewer ? awaitingReview : accompaniments).length === 0 ? <p className="px-5 py-10 text-center text-sm text-muted">No Coaching records match the selected period and principal.</p> : null}
          </div>
        </article>
        <article className="rounded-2xl border border-border bg-surface p-5 shadow-sm"><h2 className="font-semibold text-foreground">Follow-through watchlist</h2><p className="mt-1 text-xs text-muted">Open actions from the same live Coaching records.</p><div className="mt-3 divide-y divide-border">{actions.filter((item) => !closedActions.has(item.status)).slice(0, 10).map((action) => <div key={action.id} className="py-3"><p className="text-sm font-medium text-foreground">{action.issue}</p><p className="mt-1 text-xs text-muted">{action.coaching_area ?? "General"} · {statusLabel(action.status)} · {action.target_date ? `Due ${displayDate(action.target_date)}` : "No due date"}</p></div>)}{actions.filter((item) => !closedActions.has(item.status)).length === 0 ? <p className="py-8 text-sm text-muted">No open action items in this view.</p> : null}</div><div className="mt-4 rounded-xl bg-accent-blue-soft/50 p-3"><p className="text-xs font-semibold text-primary-blue">Review completion</p><p className="mt-1 text-2xl font-bold text-foreground">{percentage(accompaniments.filter((item) => reviewComplete.has(item.status)).length, submitted.length)}%</p><p className="mt-1 text-xs text-muted">Completed review decisions in this period.</p></div></article>
      </section>
    </div>
  );
}
