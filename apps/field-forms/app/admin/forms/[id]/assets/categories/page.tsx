import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import AssetAdminNav from "@/components/AssetAdminNav";
import type { AssetCategory, AssetFieldRule } from "@/lib/assetTypes";
import CategoriesManager from "./CategoriesManager";

export default async function CategoriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase
    .from("forms")
    .select("id, title")
    .eq("id", id)
    .single();
  if (!form) notFound();

  const { data: categories } = await supabase
    .from("asset_categories")
    .select("id, form_id, name, parent_id, is_active, order_index, requires_manager_review")
    .eq("form_id", id)
    .order("order_index");

  const { data: fieldRules } = await supabase
    .from("asset_field_rules")
    .select("id, category_id, field_key, is_required");

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Asset system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">
          {form.title}
        </h1>

        <FormAdminNav formId={id} />
        <AssetAdminNav formId={id} />

        <CategoriesManager
          formId={id}
          initialCategories={(categories ?? []) as AssetCategory[]}
          initialFieldRules={(fieldRules ?? []) as AssetFieldRule[]}
        />
      </div>
    </main>
  );
}
