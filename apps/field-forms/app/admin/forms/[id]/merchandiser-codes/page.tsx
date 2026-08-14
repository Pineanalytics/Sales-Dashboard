import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import MerchandiserCodesManager from "./MerchandiserCodesManager";

export default async function MerchandiserCodesPage({
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

  const { data: codes } = await supabase
    .from("merchandiser_codes")
    .select("id, code, email, is_active")
    .eq("form_id", id)
    .order("code");

  const { data: assignments } = await supabase
    .from("merchandiser_assignments")
    .select("id, merchandiser_code_id, person_name, effective_from, effective_to")
    .eq("form_id", id)
    .order("effective_from", { ascending: false });

  const { data: requests } = await supabase
    .from("merchandiser_reassignment_requests")
    .select(
      `id, person_name, reason, status, created_at,
       requested_by, current_code_id, requested_code_id,
       profiles!merchandiser_reassignment_requests_requested_by_fkey ( email, full_name )`
    )
    .eq("form_id", id)
    .order("created_at", { ascending: false });

  // Only registered, approved users on this form can be assigned a code —
  // no free-text names, so a reassignment always points at a real account.
  const { data: eligibleUsers } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .eq("assigned_form_id", id)
    .eq("role", "user")
    .eq("status", "approved")
    .order("full_name");

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="mb-6">
          <Link
            href="/admin"
            className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
          >
            ← Back to forms
          </Link>
        </div>
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          {form.title}
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-8">
          Merchandiser Codes
        </h1>

        <FormAdminNav formId={id} />

        <MerchandiserCodesManager
          formId={id}
          codes={codes ?? []}
          assignments={assignments ?? []}
          requests={(requests ?? []) as any}
          eligibleUsers={(eligibleUsers ?? []).map((u) => {
            // Match the short first-name convention already used in past
            // submissions and assignments (e.g. "Beryl", not "Beryl
            // Adhiambo") so a reassignment lines up with the same person's
            // history instead of splitting them into a second entry.
            const trimmedName = (u.full_name ?? "").trim();
            const shortName = trimmedName ? trimmedName.split(/\s+/)[0] : u.email;
            return { id: u.id, label: shortName, fullLabel: trimmedName || u.email };
          })}
        />
      </div>
    </main>
  );
}
