import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import DashboardSubNav from "../DashboardSubNav";
import { byLabel, getFormFieldsAndRows } from "@/lib/formData";
import { buildGroupSummaries } from "@/lib/dashboard";
import GroupTable from "../GroupTable";

export default async function RetailersListPage({
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

  const retailer = byLabel(fields, "Retailer Name");
  if (!retailer) {
    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <FormAdminNav formId={id} />
          <DashboardSubNav formId={id} />
          <p className="text-sm text-[var(--ink-600)]">
            This form has no retailer field to analyze.
          </p>
        </div>
      </main>
    );
  }

  const retailerOther = byLabel(fields, "Retailer Name (if Other)");
  const location = byLabel(fields, "Retailer Location / Branch");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");

  const retailers = buildGroupSummaries(rows, {
    group: retailer.id,
    groupOther: retailerOther?.id,
    outlet: location?.id,
    outletOther: locationOther?.id,
    sharePct: shelfPct?.id,
    oos: oos?.id,
    positioning: positioning?.id,
  });

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Dashboard
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">
          Retailers — {form.title}
        </h1>

        <FormAdminNav formId={id} />
        <DashboardSubNav formId={id} />

        <GroupTable
          formId={id}
          groups={retailers}
          basePath={`/admin/forms/${id}/dashboard/retailers`}
          nameLabel="Retailer"
          outletsLabel="Branches covered"
        />
      </div>
    </main>
  );
}
