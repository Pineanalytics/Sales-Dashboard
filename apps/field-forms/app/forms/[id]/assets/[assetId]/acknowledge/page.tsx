import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset } from "@/lib/assetTypes";
import AcknowledgeForm from "./AcknowledgeForm";

export default async function AcknowledgePage({
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
  if (asset.current_employee_id !== user.id) redirect(`/forms/${id}/assets`);
  if (!["Transferred", "Returned"].includes(asset.status)) {
    redirect(`/forms/${id}/assets`);
  }

  const { data: form } = await supabase
    .from("forms")
    .select("declaration_text, brand_name, title")
    .eq("id", id)
    .single();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, employee_number")
    .eq("id", user.id)
    .single();

  return (
    <AcknowledgeForm
      formId={id}
      asset={asset as Asset}
      declarationText={form?.declaration_text ?? ""}
      brandName={form?.brand_name ?? form?.title ?? ""}
      fullName={profile?.full_name ?? ""}
      employeeNumber={profile?.employee_number ?? ""}
    />
  );
}
