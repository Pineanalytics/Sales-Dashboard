import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset } from "@/lib/assetTypes";
import ManagerQueue from "./ManagerQueue";

export default async function ManagerQueuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title, brand_name")
    .eq("id", id)
    .single();
  if (!form) notFound();

  // RLS (is_manager_of) already limits this to reports' assets — the status
  // filter here is just which of those need this reviewer's attention.
  const { data: assets } = await supabase
    .from("assets")
    .select(
      "id, asset_number, description, category_id, condition, current_employee_id, created_at"
    )
    .eq("form_id", id)
    .eq("status", "Pending Manager Review")
    .order("created_at", { ascending: true });

  const employeeIds = [...new Set((assets ?? []).map((a) => a.current_employee_id).filter(Boolean))] as string[];
  const { data: employees } = employeeIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", employeeIds)
    : { data: [] };
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e.full_name || e.email]));

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          {form.brand_name ?? form.title}
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-8">
          Awaiting your review
        </h1>

        <ManagerQueue
          formId={id}
          assets={(assets ?? []) as Asset[]}
          employeeNames={Object.fromEntries(employeeById)}
        />
      </div>
    </main>
  );
}
