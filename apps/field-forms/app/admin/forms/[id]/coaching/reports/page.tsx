import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ReportsPanel from "./ReportsPanel";

export default async function CoachingReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title, brand_name").eq("id", id).single();
  if (!form) notFound();

  const [{ data: accompaniments }, { data: visits }, { data: actions }, { data: outlets }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("coaching_accompaniments")
        .select("id, date, team_leader_id, sales_rep_id, route_id, status, overall_score, start_time, end_time"),
      supabase
        .from("coaching_outlet_visits")
        .select(
          "id, accompaniment_id, outlet_id, planned, arrival_at, departure_at, distance_from_outlet_m, geofence_status"
        ),
      supabase
        .from("coaching_action_plans")
        .select(
          "id, accompaniment_id, issue, coaching_area, required_action, owner_id, target_date, priority, status, evidence_required, evidence_url"
        ),
      supabase.from("coaching_outlets").select("id, name, outlet_code"),
      supabase.from("profiles").select("id, full_name").eq("assigned_form_id", id),
    ]);
  const [{ data: routes }, { data: reps }] = await Promise.all([
    supabase.from("coaching_routes").select("id, name").eq("form_id", id),
    supabase.from("coaching_sales_reps").select("id, full_name").eq("form_id", id),
  ]);

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 pb-16">
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">Reports</h1>
        <ReportsPanel
          brandName={form.brand_name ?? form.title}
          accompaniments={accompaniments ?? []}
          visits={visits ?? []}
          actions={actions ?? []}
          outlets={outlets ?? []}
          profiles={profiles ?? []}
          reps={reps ?? []}
          routes={routes ?? []}
        />
      </div>
    </main>
  );
}
