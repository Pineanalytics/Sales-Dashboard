import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import DashboardSubNav from "../DashboardSubNav";
import { byLabel, getFormFieldsAndRows } from "@/lib/formData";
import { buildOutletSummaries } from "@/lib/dashboard";
import OutletsTable from "./OutletsTable";

export default async function OutletsListPage({
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

  const location = byLabel(fields, "Retailer Location / Branch");
  if (!location) {
    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-4xl mx-auto px-6 py-12">
          <FormAdminNav formId={id} />
          <DashboardSubNav formId={id} />
          <p className="text-sm text-[var(--ink-600)]">
            This form has no branch/location field to analyze.
          </p>
        </div>
      </main>
    );
  }

  const retailer = byLabel(fields, "Retailer Name");
  const retailerOther = byLabel(fields, "Retailer Name (if Other)");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const region = byLabel(fields, "Region");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");

  const outlets = buildOutletSummaries(rows, {
    location: location.id,
    locationOther: locationOther?.id,
    retailer: retailer?.id,
    retailerOther: retailerOther?.id,
    region: region?.id,
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
          Branches — {form.title}
        </h1>

        <FormAdminNav formId={id} />
        <DashboardSubNav formId={id} />

        <OutletsTable
          formId={id}
          outlets={outlets}
          totalKnownOutlets={location.options?.length ?? 0}
        />
      </div>
    </main>
  );
}
