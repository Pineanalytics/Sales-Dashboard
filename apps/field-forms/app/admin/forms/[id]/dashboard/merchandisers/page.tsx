import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import DashboardSubNav from "../DashboardSubNav";
import { byLabel, getFormFieldsAndRows } from "@/lib/formData";
import { buildGroupSummaries } from "@/lib/dashboard";
import GroupTable from "../GroupTable";

export default async function MerchandisersListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await params;
  const { from, to } = await searchParams;
  const supabase = await createClient();

  const { form, fields, rows } = await getFormFieldsAndRows(supabase, id, { from, to });
  if (!form) notFound();

  const merchandiser = byLabel(fields, "Merchandiser Name");
  if (!merchandiser) {
    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <FormAdminNav formId={id} />
          <DashboardSubNav formId={id} />
          <p className="text-sm text-[var(--ink-600)]">
            This form has no merchandiser field to analyze.
          </p>
        </div>
      </main>
    );
  }

  const location = byLabel(fields, "Retailer Location / Branch");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");

  const merchandisers = buildGroupSummaries(rows, {
    group: merchandiser.id,
    outlet: location?.id,
    outletOther: locationOther?.id,
    sharePct: shelfPct?.id,
    oos: oos?.id,
    positioning: positioning?.id,
  });

  const { data: currentAssignments } = await supabase
    .from("merchandiser_assignments")
    .select("person_name, merchandiser_codes(code)")
    .eq("form_id", id)
    .is("effective_to", null);
  const codeByKey = Object.fromEntries(
    (currentAssignments ?? [])
      .filter((a: any) => a.merchandiser_codes?.code)
      .map((a: any) => [a.person_name, a.merchandiser_codes.code])
  );

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Dashboard
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">
          Merchandisers — {form.title}
        </h1>

        <FormAdminNav formId={id} />
        <DashboardSubNav formId={id} />

        <GroupTable
          formId={id}
          groups={merchandisers}
          basePath={`/admin/forms/${id}/dashboard/merchandisers`}
          nameLabel="Merchandiser"
          outletsLabel="Branches covered"
          codeByKey={codeByKey}
        />
      </div>
    </main>
  );
}
