import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AccompanimentWorkspace from "./AccompanimentWorkspace";

export default async function AccompanimentPage({
  params,
}: {
  params: Promise<{ id: string; accompanimentId: string }>;
}) {
  const { id, accompanimentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: accompaniment } = await supabase
    .from("coaching_accompaniments")
    .select("*")
    .eq("id", accompanimentId)
    .single();
  if (!accompaniment) notFound();

  let outletsQuery = supabase
    .from("coaching_outlets")
    .select("id, name, address, latitude, longitude, geofence_radius_m")
    .eq("form_id", id)
    .eq("is_active", true)
    .order("name")
    .limit(500);
  if (accompaniment.route_id) {
    outletsQuery = outletsQuery.eq("route_id", accompaniment.route_id);
  }

  const [{ data: sections }, { data: outlets }, { data: visits }, { data: rep }] = await Promise.all([
    supabase
      .from("coaching_template_sections")
      .select("*, coaching_template_questions(*)")
      .eq("template_id", accompaniment.template_id)
      .order("order_index"),
    outletsQuery,
    supabase
      .from("coaching_outlet_visits")
      .select("*")
      .eq("accompaniment_id", accompanimentId)
      .order("created_at"),
    supabase.from("coaching_sales_reps").select("id, full_name").eq("id", accompaniment.sales_rep_id).single(),
  ]);

  const visitIds = (visits ?? []).map((v) => v.id);
  const { data: answers } = visitIds.length
    ? await supabase.from("coaching_visit_answers").select("*").in("outlet_visit_id", visitIds)
    : { data: [] };
  const { data: photos } = visitIds.length
    ? await supabase.from("coaching_photos").select("*").in("outlet_visit_id", visitIds)
    : { data: [] };
  const { data: actionPlans } = await supabase
    .from("coaching_action_plans")
    .select("*")
    .eq("accompaniment_id", accompanimentId);
  const { data: selfEval } = await supabase
    .from("coaching_self_evaluations")
    .select("*")
    .eq("accompaniment_id", accompanimentId)
    .maybeSingle();

  // Route-scoped outlets covers the common case, but a visit already recorded
  // for an outlet outside that route (e.g. route was reassigned mid-run)
  // still needs to resolve — top up with those specific outlets by id.
  let allOutlets = outlets ?? [];
  const missingOutletIds = (visits ?? [])
    .map((v) => v.outlet_id)
    .filter((oid) => !allOutlets.some((o) => o.id === oid));
  if (missingOutletIds.length > 0) {
    const { data: extraOutlets } = await supabase
      .from("coaching_outlets")
      .select("id, name, address, latitude, longitude, geofence_radius_m")
      .in("id", missingOutletIds);
    allOutlets = [...allOutlets, ...(extraOutlets ?? [])];
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Accompaniment
        </p>
        <h1 className="font-display text-2xl text-[var(--ink-900)] mb-6">
          {rep?.full_name ?? "Sales Rep"} — {accompaniment.date}
        </h1>

        <AccompanimentWorkspace
          formId={id}
          accompaniment={accompaniment}
          sections={(sections ?? []) as any}
          outlets={allOutlets}
          initialVisits={visits ?? []}
          initialAnswers={answers ?? []}
          initialActionPlans={actionPlans ?? []}
          initialSelfEval={selfEval ?? null}
          initialPhotos={photos ?? []}
          salesRepId={accompaniment.sales_rep_id}
        />
      </div>
    </main>
  );
}
