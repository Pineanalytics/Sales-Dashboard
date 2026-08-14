import Link from "next/link";
import { notFound } from "next/navigation";
import { BarList, ChartCard, DailyTrend, SplitBar, StatTile } from "../../dashboard/DashboardWidgets";
import { createClient } from "@/lib/supabase/server";

type SearchParams = { from?: string; to?: string; principal?: string };

const closedActionStatuses = new Set(["completed", "verified", "closed"]);
const reviewCompleteStatuses = new Set(["supervisor_reviewed", "approved"]);

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function countBy<T>(items: T[], valueOf: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = valueOf(item)?.trim();
    if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Operational cockpit for the management cadence. It intentionally derives all
 * measures from accompaniment and action-plan records rather than copying the
 * headline numbers from the older overview page, so every percentage can drill
 * to its owning records in the review queue.
 */
export default async function CoachingManagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: formId } = await params;
  const supplied = await searchParams;
  const today = new Date();
  const defaultFrom = dateOnly(new Date(today.getFullYear(), today.getMonth(), 1));
  const from = supplied.from && /^\d{4}-\d{2}-\d{2}$/.test(supplied.from) ? supplied.from : defaultFrom;
  const to = supplied.to && /^\d{4}-\d{2}-\d{2}$/.test(supplied.to) ? supplied.to : dateOnly(today);
  const selectedPrincipal = supplied.principal ?? "";
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", formId).single();
  if (!form) notFound();

  const { data: principals } = await supabase
    .from("coaching_principals")
    .select("id, name")
    .eq("form_id", formId)
    .eq("is_active", true)
    .order("name");

  const { data: allAccompaniments } = await supabase
    .from("coaching_accompaniments")
    .select("id, date, status, overall_score, supervisor_comments, team_leader_id, sales_rep_id")
    .eq("form_id", formId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false })
    .limit(1000);

  const accompanimentIds = (allAccompaniments ?? []).map((item) => item.id);
  const [{ data: visits }, { data: outlets }, { data: profiles }, { data: reps }] = await Promise.all([
    accompanimentIds.length
      ? supabase
          .from("coaching_outlet_visits")
          .select("accompaniment_id, outlet_id")
          .in("accompaniment_id", accompanimentIds)
      : Promise.resolve({ data: [] }),
    supabase.from("coaching_outlets").select("id, principal_id").eq("form_id", formId),
    supabase.from("profiles").select("id, full_name").eq("assigned_form_id", formId),
    supabase.from("coaching_sales_reps").select("id, full_name").eq("form_id", formId),
  ]);

  const outletById = new Map((outlets ?? []).map((outlet) => [outlet.id, outlet]));
  const principalIdByAccompaniment = new Map<string, Set<string>>();
  for (const visit of visits ?? []) {
    const principalId = outletById.get(visit.outlet_id)?.principal_id;
    if (!principalId) continue;
    const ids = principalIdByAccompaniment.get(visit.accompaniment_id) ?? new Set<string>();
    ids.add(principalId);
    principalIdByAccompaniment.set(visit.accompaniment_id, ids);
  }

  const accompaniments = (allAccompaniments ?? []).filter(
    (item) => !selectedPrincipal || principalIdByAccompaniment.get(item.id)?.has(selectedPrincipal)
  );
  const includedIds = accompaniments.map((item) => item.id);
  const { data: actionPlans } = includedIds.length
    ? await supabase
        .from("coaching_action_plans")
        .select("id, accompaniment_id, issue, coaching_area, priority, target_date, status")
        .in("accompaniment_id", includedIds)
        .order("target_date", { ascending: true, nullsFirst: false })
        .limit(2000)
    : { data: [] };

  const leaderName = (id: string) => profiles?.find((profile) => profile.id === id)?.full_name ?? "Unassigned";
  const repName = (id: string) => reps?.find((rep) => rep.id === id)?.full_name ?? "Unassigned";
  const submitted = accompaniments.filter((item) => item.status !== "draft");
  const approved = accompaniments.filter((item) => item.status === "approved");
  const reviewed = accompaniments.filter((item) => reviewCompleteStatuses.has(item.status));
  const feedbackRecorded = accompaniments.filter((item) => Boolean(item.supervisor_comments?.trim()));
  const awaitingReview = accompaniments.filter((item) => ["submitted", "sales_rep_acknowledged"].includes(item.status));
  const actions = actionPlans ?? [];
  const closedActions = actions.filter((item) => closedActionStatuses.has(item.status));
  const overdueActions = actions.filter(
    (item) => item.target_date && item.target_date < dateOnly(today) && !closedActionStatuses.has(item.status)
  );
  const scores = accompaniments.filter((item) => item.overall_score != null);
  const averageScore = scores.length
    ? Math.round((scores.reduce((sum, item) => sum + (item.overall_score ?? 0), 0) / scores.length) * 10) / 10
    : null;
  const uniqueOutlets = new Set(
    (visits ?? []).filter((visit) => includedIds.includes(visit.accompaniment_id)).map((visit) => visit.outlet_id)
  ).size;

  const pipeline = [
    { label: "Draft", count: accompaniments.filter((item) => item.status === "draft").length },
    { label: "Awaiting review", count: awaitingReview.length },
    { label: "Review complete", count: reviewed.length },
    { label: "Approved", count: approved.length },
  ];
  const teamLeaderScores = new Map<string, number[]>();
  for (const item of scores) {
    const label = leaderName(item.team_leader_id);
    teamLeaderScores.set(label, [...(teamLeaderScores.get(label) ?? []), item.overall_score ?? 0]);
  }
  const scoreByLeader = [...teamLeaderScores.entries()]
    .map(([label, values]) => ({
      label,
      count: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const dailyActivity = countBy(accompaniments, (item) => item.date)
    .map((item) => ({ date: item.label, count: item.count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 mb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">Management workspace</p>
            <h1 className="font-display text-3xl text-[var(--ink-900)]">Feedback & attainment</h1>
            <p className="text-sm text-[var(--ink-600)] mt-1">{form.title} · approvals, feedback quality, coaching outcomes and follow-through in one view.</p>
          </div>
          <Link href={`/admin/forms/${formId}/coaching/review`} className="rounded-md bg-[var(--pine-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--pine-900)]">
            Open review queue ({awaitingReview.length})
          </Link>
        </div>

        <form className="mb-6 grid grid-cols-1 gap-3 rounded-xl border border-[var(--line)] bg-white p-4 sm:grid-cols-4" method="get">
          <label className="text-xs text-[var(--ink-600)]">From<input name="from" type="date" defaultValue={from} className="mt-1 block w-full rounded-md border border-[var(--line)] px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-[var(--ink-600)]">To<input name="to" type="date" defaultValue={to} className="mt-1 block w-full rounded-md border border-[var(--line)] px-2 py-1.5 text-sm" /></label>
          <label className="text-xs text-[var(--ink-600)]">Principal<select name="principal" defaultValue={selectedPrincipal} className="mt-1 block w-full rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"><option value="">All principals</option>{principals?.map((principal) => <option key={principal.id} value={principal.id}>{principal.name}</option>)}</select></label>
          <div className="flex items-end gap-2"><button className="rounded-md bg-[var(--pine-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--pine-900)]">Apply</button><Link href={`/admin/forms/${formId}/coaching/management`} className="px-2 py-2 text-sm text-[var(--pine-700)] hover:underline">Reset</Link></div>
        </form>

        <p className="mb-4 text-xs text-[var(--ink-400)]">Period: {displayDate(from)} – {displayDate(to)}. Feedback attainment means completed reviews with a recorded supervisor comment; it is not inferred from an approval alone.</p>

        <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">
          <StatTile label="Accompaniments" value={String(accompaniments.length)} sub={`${uniqueOutlets} unique outlets visited`} icon="🧭" />
          <StatTile label="Approval attainment" value={`${percent(approved.length, submitted.length)}%`} sub={`${approved.length} approved of ${submitted.length} submitted`} icon="✓" />
          <StatTile label="Feedback recorded" value={`${percent(feedbackRecorded.length, submitted.length)}%`} sub={`${feedbackRecorded.length} records carry feedback`} icon="💬" />
          <StatTile label="Action closure" value={`${percent(closedActions.length, actions.length)}%`} sub={`${overdueActions.length} overdue action${overdueActions.length === 1 ? "" : "s"}`} icon="→" />
          <StatTile label="Average coaching score" value={averageScore == null ? "—" : `${averageScore}%`} sub={`${scores.length} scored accompaniment${scores.length === 1 ? "" : "s"}`} icon="◎" />
          <StatTile label="Awaiting review" value={String(awaitingReview.length)} sub="Submitted or acknowledged" icon="⌛" />
          <StatTile label="Review completion" value={`${percent(reviewed.length, submitted.length)}%`} sub={`${reviewed.length} decision(s) complete`} icon="▣" />
          <StatTile label="Open actions" value={String(actions.length - closedActions.length)} sub={`${actions.length} action plan item${actions.length === 1 ? "" : "s"}`} icon="⚑" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard title="Review pipeline" sub="Record count by current workflow stage"><SplitBar counts={pipeline} criticalLabel="Awaiting review" /></ChartCard>
          <ChartCard title="Coaching activity by day" sub="Accompaniments created in the selected period"><DailyTrend data={dailyActivity} /></ChartCard>
          <ChartCard title="Average coaching score by Team Leader" sub="Scored accompaniments only"><BarList data={scoreByLeader} valueSuffix="%" maxRows={8} emptyLabel="No scored accompaniments in this period." /></ChartCard>
          <ChartCard title="Coaching gaps by area" sub="Action-plan items raised from field observations"><BarList data={countBy(actions, (item) => item.coaching_area)} maxRows={8} emptyLabel="No action-plan issues in this period." /></ChartCard>
        </div>

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <ChartCard title="Needs a management decision" sub="Most recent submitted records; open one to review the evidence, amend it or approve it.">
            <div className="divide-y divide-[var(--line)]">
              {awaitingReview.slice(0, 6).map((item) => <Link key={item.id} href={`/forms/${formId}/coaching/review/${item.id}`} className="flex items-center justify-between gap-3 py-3 text-sm hover:text-[var(--pine-700)]"><span><span className="font-medium text-[var(--ink-900)]">{leaderName(item.team_leader_id)}</span><span className="text-[var(--ink-600)]"> → {repName(item.sales_rep_id)}</span><span className="block text-xs text-[var(--ink-400)]">{displayDate(item.date)} · {item.overall_score == null ? "Not scored" : `${item.overall_score}%`}</span></span><span className="text-xs font-medium text-[var(--pine-700)]">Review</span></Link>)}
              {awaitingReview.length === 0 && <p className="py-4 text-sm text-[var(--ink-600)]">No accompaniments are waiting for review.</p>}
            </div>
          </ChartCard>
          <ChartCard title="Follow-through watchlist" sub="Open action-plan items with the nearest due date first.">
            <div className="divide-y divide-[var(--line)]">
              {actions.filter((item) => !closedActionStatuses.has(item.status)).slice(0, 6).map((item) => <div key={item.id} className="py-3 text-sm"><p className="font-medium text-[var(--ink-900)]">{item.issue}</p><p className="mt-1 text-xs text-[var(--ink-600)]">{item.coaching_area ?? "General"} · {item.status.replace(/_/g, " ")} · {item.target_date ? `Due ${displayDate(item.target_date)}` : "No due date"}</p></div>)}
              {actions.filter((item) => !closedActionStatuses.has(item.status)).length === 0 && <p className="py-4 text-sm text-[var(--ink-600)]">No open action-plan items in this period.</p>}
            </div>
          </ChartCard>
        </section>
      </div>
    </main>
  );
}
