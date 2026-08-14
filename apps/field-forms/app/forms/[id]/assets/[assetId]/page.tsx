import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AssetViewPage({
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

  if (asset.status === "Draft" || asset.status === "Returned for Correction") {
    if (asset.current_employee_id === user.id || asset.created_by === user.id) {
      redirect(`/forms/${id}/assets/${assetId}/edit`);
    }
  }
  if (
    (asset.status === "Transferred" || asset.status === "Returned") &&
    asset.current_employee_id === user.id
  ) {
    redirect(`/forms/${id}/assets/${assetId}/acknowledge`);
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-6">
          <Link
            href={`/forms/${id}/assets`}
            className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
          >
            ← My assets
          </Link>
        </div>
        <div className="bg-white border border-[var(--line)] rounded-lg p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h1 className="font-display text-xl text-[var(--ink-900)]">
              {asset.description || asset.asset_number || "Untitled asset"}
            </h1>
            <span className="shrink-0 text-xs font-mono-label uppercase tracking-wide rounded-full px-2.5 py-1 bg-[var(--pine-100)] text-[var(--pine-700)]">
              {asset.status}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-[var(--ink-400)] uppercase">Category</dt>
              <dd className="text-[var(--ink-900)]">{asset.category_id ? "Assigned" : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-400)] uppercase">Serial number</dt>
              <dd className="text-[var(--ink-900)]">{asset.serial_number || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-400)] uppercase">Condition</dt>
              <dd className="text-[var(--ink-900)]">{asset.condition || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--ink-400)] uppercase">Location</dt>
              <dd className="text-[var(--ink-900)]">{asset.current_location || "—"}</dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--ink-400)] mt-6">
            This asset is currently {asset.status.toLowerCase()} and can&apos;t be edited from
            here. Contact your administrator if something needs to change.
          </p>
        </div>
      </div>
    </main>
  );
}
