import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import AssetAdminNav from "@/components/AssetAdminNav";
import type { Asset } from "@/lib/assetTypes";

export default async function VerificationQueuePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  const { data: assets } = await supabase
    .from("assets")
    .select("id, asset_number, description, status, condition, current_employee_id, created_at")
    .eq("form_id", id)
    .in("status", ["Submitted", "Pending Manager Review", "Pending Admin Verification"])
    .order("created_at", { ascending: true });

  const employeeIds = [...new Set((assets ?? []).map((a) => a.current_employee_id).filter(Boolean))] as string[];
  const { data: employees } = employeeIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", employeeIds)
    : { data: [] };
  const employeeById = new Map((employees ?? []).map((e) => [e.id, e.full_name || e.email]));

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Asset system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">{form.title}</h1>

        <FormAdminNav formId={id} />
        <AssetAdminNav formId={id} />

        {(!assets || assets.length === 0) && (
          <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
            Nothing awaiting verification.
          </div>
        )}

        <ul className="space-y-3">
          {(assets as Asset[] | null)?.map((asset) => (
            <li key={asset.id}>
              <Link
                href={`/admin/forms/${id}/assets/${asset.id}`}
                className="block bg-white border border-[var(--line)] rounded-lg px-5 py-4 hover:border-[var(--pine-500)] transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-display text-lg text-[var(--ink-900)]">
                      {asset.description || asset.asset_number || "Untitled asset"}
                    </h2>
                    <p className="text-sm text-[var(--ink-600)] mt-1">
                      {employeeById.get(asset.current_employee_id ?? "") ?? "Unknown employee"}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-mono-label uppercase tracking-wide rounded-full px-2.5 py-1 bg-[var(--pine-100)] text-[var(--pine-700)]">
                    {asset.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
