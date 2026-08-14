import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewAccompanimentForm from "./NewAccompanimentForm";

export default async function NewAccompanimentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("field_role")
    .eq("id", user.id)
    .single();
  const isKeyAccountRep = profile?.field_role === "key_account_rep";

  const [{ data: reps }, { data: routes }, { data: template }] = await Promise.all([
    supabase
      .from("coaching_sales_reps")
      .select("id, full_name, email")
      .eq("form_id", id)
      .eq("team_leader_id", user.id)
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("coaching_routes").select("id, name").eq("form_id", id).eq("is_active", true).order("name"),
    supabase
      .from("coaching_templates")
      .select("id, name")
      .eq("form_id", id)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!template) notFound();

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">
          {isKeyAccountRep ? "Log a Visit" : "Start Accompaniment"}
        </h1>
        <NewAccompanimentForm
          formId={id}
          templateId={template.id}
          reps={reps ?? []}
          routes={routes ?? []}
          selfMode={isKeyAccountRep}
        />
      </div>
    </main>
  );
}
