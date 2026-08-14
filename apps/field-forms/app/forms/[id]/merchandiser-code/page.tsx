import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import RequestForm from "./RequestForm";

export default async function MerchandiserCodePage({
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

  const { data: codes } = await supabase
    .from("merchandiser_codes")
    .select("id, code")
    .eq("form_id", id)
    .eq("is_active", true)
    .order("code");

  const { data: myCode } = await supabase
    .from("merchandiser_codes")
    .select("id, code")
    .eq("form_id", id)
    .eq("email", user.email)
    .maybeSingle();

  // The requester's name always comes from their own registered profile
  // (same short-name convention used everywhere else) — not free text —
  // so a request always maps back to a real, identifiable account.
  const { data: myProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .single();
  const trimmedName = (myProfile?.full_name ?? "").trim();
  const myPersonName = trimmedName ? trimmedName.split(/\s+/)[0] : myProfile?.email ?? "";

  const { data: myRequests } = await supabase
    .from("merchandiser_reassignment_requests")
    .select(
      `id, person_name, reason, status, created_at, current_code_id, requested_code_id`
    )
    .eq("form_id", id)
    .eq("requested_by", user.id)
    .order("created_at", { ascending: false });

  const codeById = new Map((codes ?? []).map((c) => [c.id, c.code]));

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-lg mx-auto px-6 py-12">
        <div className="mb-6">
          <Link href={`/forms/${id}`} className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]">
            ← Back to form
          </Link>
        </div>
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          {form.brand_name ?? form.title}
        </p>
        <h1 className="font-display text-2xl text-[var(--ink-900)] mb-8">
          Merchandiser code reassignment
        </h1>

        <RequestForm
          formId={id}
          codes={codes ?? []}
          currentCodeId={myCode?.id ?? null}
          currentCodeLabel={myCode?.code ?? null}
          personName={myPersonName}
        />

        {myRequests && myRequests.length > 0 && (
          <div className="mt-8 bg-white border border-[var(--line)] rounded-lg p-5">
            <h2 className="font-display text-base text-[var(--ink-900)] mb-3">
              Your requests
            </h2>
            <ul className="space-y-2 text-sm">
              {myRequests.map((r) => (
                <li key={r.id} className="border-b border-[var(--line)] last:border-0 pb-2">
                  <span className="text-[var(--ink-600)]">
                    {new Date(r.created_at).toLocaleDateString()} —{" "}
                  </span>
                  {r.current_code_id ? codeById.get(r.current_code_id) ?? "—" : "—"} →{" "}
                  {codeById.get(r.requested_code_id) ?? "—"}{" "}
                  <span
                    className={`text-xs font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 ml-1 ${
                      r.status === "approved"
                        ? "bg-[var(--pine-100)] text-[var(--pine-700)]"
                        : r.status === "rejected"
                          ? "bg-[#f5e2dd] text-[var(--rust-600)]"
                          : "bg-[var(--sand-100)] text-[var(--ink-600)]"
                    }`}
                  >
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
