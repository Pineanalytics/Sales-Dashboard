import type { SupabaseClient } from "@supabase/supabase-js";

export async function notifyUser(
  supabase: SupabaseClient,
  recipientId: string,
  kind: string,
  message: string,
  assetId?: string
) {
  await supabase.from("notifications").insert({
    recipient_id: recipientId,
    kind,
    asset_id: assetId ?? null,
    message,
  });
}

// Notifies every admin/super_admin scoped to this form — used when there's
// no single "the admin" to address (verification queue, lost/stolen reports).
export async function notifyFormAdmins(
  supabase: SupabaseClient,
  formId: string,
  kind: string,
  message: string,
  assetId?: string
) {
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("assigned_form_id", formId)
    .eq("role", "admin");
  for (const admin of admins ?? []) {
    await notifyUser(supabase, admin.id, kind, message, assetId);
  }
}
