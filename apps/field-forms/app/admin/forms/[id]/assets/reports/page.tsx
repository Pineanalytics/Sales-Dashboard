import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import AssetAdminNav from "@/components/AssetAdminNav";
import ReportsPanel from "./ReportsPanel";

export default async function ReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title, brand_name")
    .eq("id", id)
    .single();
  if (!form) notFound();

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("assigned_form_id", id)
    .eq("status", "approved");

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Asset system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">{form.title}</h1>

        <FormAdminNav formId={id} />
        <AssetAdminNav formId={id} />

        <ReportsPanel
          formId={id}
          brandName={form.brand_name ?? form.title}
          employees={(employees ?? []).map((e) => ({ id: e.id, name: e.full_name || e.email }))}
        />
      </div>
    </main>
  );
}
