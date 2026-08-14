import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Asset } from "@/lib/assetTypes";

const STATUS_STYLE: Record<string, string> = {
  Draft: "bg-[var(--sand-100)] text-[var(--ink-600)]",
  Submitted: "bg-[var(--pine-100)] text-[var(--pine-700)]",
  "Pending Manager Review": "bg-[var(--pine-100)] text-[var(--pine-700)]",
  "Pending Admin Verification": "bg-[var(--pine-100)] text-[var(--pine-700)]",
  "Returned for Correction": "bg-[#f5e2dd] text-[var(--rust-600)]",
  Verified: "bg-[var(--pine-100)] text-[var(--pine-700)]",
  Rejected: "bg-[#f5e2dd] text-[var(--rust-600)]",
  Active: "bg-[var(--pine-100)] text-[var(--pine-700)]",
};

export default async function MyAssetsPage({
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

  const { data: assets } = await supabase
    .from("assets")
    .select(
      "id, asset_number, description, status, category_id, condition, created_at"
    )
    .eq("form_id", id)
    .or(`current_employee_id.eq.${user.id},created_by.eq.${user.id}`)
    .order("created_at", { ascending: false });

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
              {form.brand_name ?? form.title}
            </p>
            <h1 className="font-display text-3xl text-[var(--ink-900)]">
              My assets
            </h1>
          </div>
          <Link
            href={`/forms/${id}/assets/new`}
            className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2.5 hover:bg-[var(--pine-900)] transition-colors"
          >
            + Register asset
          </Link>
        </div>

        {(!assets || assets.length === 0) && (
          <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
            No assets registered yet.
          </div>
        )}

        <ul className="space-y-3">
          {(assets as Asset[] | null)?.map((asset) => {
            const editable =
              asset.status === "Draft" || asset.status === "Returned for Correction";
            return (
              <li key={asset.id}>
                <Link
                  href={
                    editable
                      ? `/forms/${id}/assets/${asset.id}/edit`
                      : `/forms/${id}/assets/${asset.id}`
                  }
                  className="block bg-white border border-[var(--line)] rounded-lg px-5 py-4 hover:border-[var(--pine-500)] transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="font-display text-lg text-[var(--ink-900)]">
                        {asset.description || asset.asset_number || "Untitled asset"}
                      </h2>
                      <p className="text-sm text-[var(--ink-600)] mt-1">
                        {asset.asset_number ? `#${asset.asset_number} · ` : ""}
                        {asset.condition ?? "Condition not set"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-xs font-mono-label uppercase tracking-wide rounded-full px-2.5 py-1 ${
                        STATUS_STYLE[asset.status] ??
                        "bg-[var(--sand-100)] text-[var(--ink-600)]"
                      }`}
                    >
                      {asset.status}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
