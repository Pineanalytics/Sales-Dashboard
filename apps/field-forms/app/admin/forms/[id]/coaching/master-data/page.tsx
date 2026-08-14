import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  CoachingOrgUnit,
  CoachingChannel,
  CoachingRoute,
  CoachingOutlet,
  CoachingPrincipal,
} from "@/lib/coachingTypes";
import MasterDataManager from "./MasterDataManager";

export default async function MasterDataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  const [
    { data: orgUnits },
    { data: channels },
    { data: routes },
    { data: outlets },
    { data: profiles },
    { data: salesReps },
    { data: principals },
  ] = await Promise.all([
    supabase.from("coaching_org_units").select("*").eq("form_id", id).order("name"),
    supabase.from("coaching_channels").select("*").eq("form_id", id).order("name"),
    supabase.from("coaching_routes").select("*").eq("form_id", id).order("name"),
    supabase.from("coaching_outlets").select("*").eq("form_id", id).order("outlet_code"),
    supabase
      .from("profiles")
      .select("id, full_name, email, field_role, manager_id")
      .eq("assigned_form_id", id),
    supabase
      .from("coaching_sales_reps")
      .select("id, full_name, email, team_leader_id")
      .eq("form_id", id)
      .order("full_name"),
    supabase.from("coaching_principals").select("*").eq("form_id", id).order("name"),
  ]);

  const teamLeaderIds = (profiles ?? []).filter((p) => p.field_role === "team_leader").map((p) => p.id);
  const { data: teamLeaderPrincipals } = teamLeaderIds.length
    ? await supabase
        .from("team_leader_principals")
        .select("team_leader_id, principal_id")
        .in("team_leader_id", teamLeaderIds)
    : { data: [] };

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-6xl mx-auto px-6 pb-16">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Coaching system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">Master Data</h1>

        <MasterDataManager
          formId={id}
          initialOrgUnits={(orgUnits ?? []) as CoachingOrgUnit[]}
          initialChannels={(channels ?? []) as CoachingChannel[]}
          initialRoutes={(routes ?? []) as CoachingRoute[]}
          initialOutlets={(outlets ?? []) as CoachingOutlet[]}
          initialProfiles={profiles ?? []}
          initialSalesReps={salesReps ?? []}
          initialPrincipals={(principals ?? []) as CoachingPrincipal[]}
          initialTeamLeaderPrincipals={teamLeaderPrincipals ?? []}
        />
      </div>
    </main>
  );
}
