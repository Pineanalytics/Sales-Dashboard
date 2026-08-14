import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function NewAssetPage({
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

  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      form_id: id,
      created_by: user.id,
      current_employee_id: user.id,
      status: "Draft",
    })
    .select("id")
    .single();

  if (error || !asset) {
    throw new Error(error?.message ?? "Could not start a new asset registration.");
  }

  redirect(`/forms/${id}/assets/${asset.id}/edit`);
}
