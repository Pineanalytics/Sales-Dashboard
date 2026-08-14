import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import AssetAdminNav from "@/components/AssetAdminNav";
import type {
  Asset,
  AssetCategory,
  AssetDuplicateFlag,
  AssetEvent,
  AssetPhoto,
  AssetSignature,
} from "@/lib/assetTypes";
import AssetDetail from "./AssetDetail";

export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string; assetId: string }>;
}) {
  const { id, assetId } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .eq("form_id", id)
    .single();
  if (!asset) notFound();

  const [
    { data: categories },
    { data: photos },
    { data: signatures },
    { data: events },
    { data: duplicates },
    { data: employees },
  ] = await Promise.all([
    supabase
      .from("asset_categories")
      .select("id, form_id, name, parent_id, is_active, order_index, requires_manager_review")
      .eq("form_id", id),
    supabase.from("asset_photos").select("*").eq("asset_id", assetId),
    supabase.from("asset_signatures").select("*").eq("asset_id", assetId),
    supabase.from("asset_events").select("*").eq("asset_id", assetId).order("created_at", { ascending: false }),
    supabase.from("asset_duplicates_flagged").select("*").eq("asset_id", assetId).eq("resolved", false),
    supabase.from("profiles").select("id, full_name, email, status").eq("assigned_form_id", id).eq("status", "approved"),
  ]);

  const employeeName = asset.current_employee_id
    ? (employees ?? []).find((e) => e.id === asset.current_employee_id)?.full_name ??
      (employees ?? []).find((e) => e.id === asset.current_employee_id)?.email ??
      null
    : null;

  const actorIds = [...new Set((events ?? []).map((e) => e.actor_id).filter(Boolean))] as string[];
  const actorNames = new Map(
    (employees ?? [])
      .filter((e) => actorIds.includes(e.id))
      .map((e) => [e.id, e.full_name || e.email])
  );

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Asset system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">{form.title}</h1>

        <FormAdminNav formId={id} />
        <AssetAdminNav formId={id} />

        <AssetDetail
          formId={id}
          asset={asset as Asset}
          categories={(categories ?? []) as AssetCategory[]}
          photos={(photos ?? []) as AssetPhoto[]}
          signatures={(signatures ?? []) as AssetSignature[]}
          events={(events ?? []) as AssetEvent[]}
          duplicates={(duplicates ?? []) as AssetDuplicateFlag[]}
          employeeName={employeeName}
          actorNames={Object.fromEntries(actorNames)}
          employees={(employees ?? []).map((e) => ({ id: e.id, name: e.full_name || e.email }))}
        />
      </div>
    </main>
  );
}
