import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormBuilder from "../FormBuilder";

export default async function NewFormPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user!.id)
    .single();

  // Only super admins spin up brand-new agency forms; form admins manage
  // the one form they're already assigned to.
  if (profile?.role !== "super_admin") {
    redirect("/admin");
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <FormBuilder />
    </main>
  );
}
