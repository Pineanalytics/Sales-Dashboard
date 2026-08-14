import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset, AssetCategory, AssetFieldRule, AssetPhoto } from "@/lib/assetTypes";
import AssetRegistrationForm from "./AssetRegistrationForm";

export default async function EditAssetPage({
  params,
}: {
  params: Promise<{ id: string; assetId: string }>;
}) {
  const { id, assetId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("id", assetId)
    .eq("form_id", id)
    .single();
  if (!asset) notFound();

  const isOwner = asset.current_employee_id === user.id || asset.created_by === user.id;
  if (!isOwner) redirect(`/forms/${id}/assets`);
  if (asset.status !== "Draft" && asset.status !== "Returned for Correction") {
    redirect(`/forms/${id}/assets`);
  }

  const { data: form } = await supabase
    .from("forms")
    .select("id, title, brand_name, declaration_text")
    .eq("id", id)
    .single();
  if (!form) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, employee_number, job_title, department, cost_centre, territory, work_location, manager_id"
    )
    .eq("id", user.id)
    .single();

  let managerName: string | null = null;
  if (profile?.manager_id) {
    const { data: manager } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", profile.manager_id)
      .single();
    managerName = manager?.full_name ?? manager?.email ?? null;
  }

  const { data: categories } = await supabase
    .from("asset_categories")
    .select("id, form_id, name, parent_id, is_active, order_index")
    .eq("form_id", id)
    .eq("is_active", true)
    .order("order_index");

  const { data: fieldRules } = await supabase
    .from("asset_field_rules")
    .select("id, category_id, field_key, is_required");

  const { data: photos } = await supabase
    .from("asset_photos")
    .select("id, asset_id, kind, storage_url, uploaded_by, created_at")
    .eq("asset_id", assetId);

  return (
    <AssetRegistrationForm
      formId={id}
      asset={asset as Asset}
      formTitle={form.brand_name ?? form.title}
      declarationText={form.declaration_text ?? ""}
      profile={{
        email: profile?.email ?? user.email ?? "",
        fullName: profile?.full_name ?? "",
        employeeNumber: profile?.employee_number ?? "",
        jobTitle: profile?.job_title ?? "",
        department: profile?.department ?? "",
        costCentre: profile?.cost_centre ?? "",
        territory: profile?.territory ?? "",
        workLocation: profile?.work_location ?? "",
        managerName,
      }}
      categories={(categories ?? []) as AssetCategory[]}
      fieldRules={(fieldRules ?? []) as AssetFieldRule[]}
      initialPhotos={(photos ?? []) as AssetPhoto[]}
    />
  );
}
