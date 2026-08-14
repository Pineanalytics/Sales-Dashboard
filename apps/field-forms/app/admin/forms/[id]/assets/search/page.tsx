import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import AssetAdminNav from "@/components/AssetAdminNav";
import SearchPanel from "./SearchPanel";

export default async function AssetSearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Asset system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">{form.title}</h1>

        <FormAdminNav formId={id} />
        <AssetAdminNav formId={id} />

        <SearchPanel formId={id} />
      </div>
    </main>
  );
}
