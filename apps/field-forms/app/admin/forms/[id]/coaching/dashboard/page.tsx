import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatTile, ChartCard, BarList } from "../../dashboard/DashboardWidgets";
import { performanceBandFor } from "@/lib/coachingTypes";

export default async function CoachingDashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  const [{ data: accompaniments }, { data: visits }, { data: actions }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("coaching_accompaniments")
        .select("id, team_leader_id, sales_rep_id, status, overall_score, date"),
      supabase.from("coaching_outlet_visits").select("id, accompaniment_id, planned, geofence_status"),
      supabase.from("coaching_action_plans").select("id, status, coaching_area"),
      supabase.from("profiles").select("id, full_name").eq("assigned_form_id", id),
    ]);

  const nameOf = (pid: string) => profiles?.find((p) => p.id === pid)?.full_name ?? "—";

  const total = accompaniments?.length ?? 0;
  const approved = accompaniments?.filter((a) => a.status === "approved").length ?? 0;
  const scored = (accompaniments ?? []).filter((a) => a.overall_score != null);
  const avgScore =
    scored.length > 0
      ? Math.round((scored.reduce((sum, a) => sum + (a.overall_score ?? 0), 0) / scored.length) * 10) / 10
      : 0;
  const band = performanceBandFor(avgScore);

  const plannedVisits = visits?.filter((v) => v.planned).length ?? 0;
  const totalVisits = visits?.length ?? 0;
  const coveragePct = totalVisits > 0 ? Math.round((plannedVisits / totalVisits) * 1000) / 10 : 0;

  const insideFence = visits?.filter((v) => v.geofence_status === "inside").length ?? 0;
  const geofenceKnown = visits?.filter((v) => v.geofence_status && v.geofence_status !== "gps_unavailable").length ?? 0;
  const geofenceCompliancePct = geofenceKnown > 0 ? Math.round((insideFence / geofenceKnown) * 1000) / 10 : 0;

  const closedActions = actions?.filter((a) => a.status === "completed" || a.status === "closed" || a.status === "verified").length ?? 0;
  const totalActions = actions?.length ?? 0;
  const actionClosurePct = totalActions > 0 ? Math.round((closedActions / totalActions) * 1000) / 10 : 0;
  const overdueActions = actions?.filter((a) => a.status === "overdue").length ?? 0;

  function countBy<T>(items: T[], keyFn: (item: T) => string | null) {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = keyFn(item);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
  }

  const byTeamLeader = countBy(accompaniments ?? [], (a) => nameOf(a.team_leader_id));
  const byActionArea = countBy(actions ?? [], (a) => a.coaching_area);
  const teamLeaderScores = new Map<string, number[]>();
  for (const a of scored) {
    if (!a.overall_score) continue;
    const arr = teamLeaderScores.get(nameOf(a.team_leader_id)) ?? [];
    arr.push(a.overall_score);
    teamLeaderScores.set(nameOf(a.team_leader_id), arr);
  }
  const teamLeaderAvgScores = [...teamLeaderScores.entries()]
    .map(([label, scores]) => ({
      label,
      count: Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">{form.title} Dashboard</h1>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatTile label="Total accompaniments" value={String(total)} icon="🧭" />
          <StatTile label="Approved" value={String(approved)} icon="✅" />
          <StatTile
            label="Avg coaching score"
            value={`${avgScore}%`}
            sub={band.label}
            icon="🎯"
          />
          <StatTile label="Outlet coverage (planned)" value={`${coveragePct}%`} icon="🗺️" />
          <StatTile label="Geofence compliance" value={`${geofenceCompliancePct}%`} icon="📍" />
          <StatTile label="Action closure" value={`${actionClosurePct}%`} icon="✔️" />
          <StatTile label="Overdue actions" value={String(overdueActions)} icon="⚠️" />
          <StatTile label="Total outlet visits" value={String(totalVisits)} icon="🏬" />
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <ChartCard title="Accompaniments by Team Leader">
            <BarList data={byTeamLeader} maxRows={10} />
          </ChartCard>
          <ChartCard title="Avg coaching score by Team Leader">
            <BarList data={teamLeaderAvgScores} valueSuffix="%" maxRows={10} />
          </ChartCard>
          <ChartCard title="Coaching gaps by area (action items)">
            <BarList data={byActionArea} maxRows={10} />
          </ChartCard>
        </div>
      </div>
    </main>
  );
}
