import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import AssetAdminNav from "@/components/AssetAdminNav";
import { StatTile, ChartCard, BarList } from "../../dashboard/DashboardWidgets";
import type { Asset, AssetCategory } from "@/lib/assetTypes";

const UNVERIFIED_STATUSES = [
  "Draft",
  "Submitted",
  "Pending Manager Review",
  "Pending Admin Verification",
  "Returned for Correction",
];
const VERIFIED_STATUSES = [
  "Verified",
  "Active",
  "Transferred",
  "Returned",
  "Under Repair",
];

export default async function AssetDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  const { data: assetsData } = await supabase
    .from("assets")
    .select(
      "id, category_id, subcategory_id, status, condition, current_employee_id, current_department, current_cost_centre, current_location, serial_number, warranty_end, updated_at"
    )
    .eq("form_id", id);
  const assets = (assetsData ?? []) as Asset[];

  const { data: categories } = await supabase
    .from("asset_categories")
    .select("id, form_id, name, parent_id, is_active, order_index, requires_manager_review")
    .eq("form_id", id);
  const categoryName = new Map((categories ?? []).map((c) => [c.id, c.name]));

  const { data: employees } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("assigned_form_id", id);
  const employeeName = new Map((employees ?? []).map((e) => [e.id, e.full_name || e.email]));

  const { count: duplicateCount } = await supabase
    .from("asset_duplicates_flagged")
    .select("id, assets!inner(form_id)", { count: "exact", head: true })
    .eq("resolved", false)
    .eq("assets.form_id", id);

  const total = assets.length;
  const verified = assets.filter((a) => VERIFIED_STATUSES.includes(a.status)).length;
  const unverified = assets.filter((a) => UNVERIFIED_STATUSES.includes(a.status)).length;
  const underRepair = assets.filter((a) => a.status === "Under Repair").length;
  const unallocated = assets.filter((a) => !a.current_employee_id).length;
  const awaitingAck = assets.filter((a) => ["Transferred", "Returned"].includes(a.status)).length;
  const awaitingVerification = assets.filter((a) => a.status === "Pending Admin Verification").length;
  const lostOrStolen = assets.filter((a) => ["Lost", "Stolen"].includes(a.status)).length;
  const retiredOrDisposed = assets.filter((a) => ["Retired", "Disposed"].includes(a.status)).length;
  const missingSerial = assets.filter((a) => !a.serial_number).length;

  const in60Days = new Date();
  in60Days.setDate(in60Days.getDate() + 60);
  const warrantyExpiringSoon = assets.filter(
    (a) => a.warranty_end && new Date(a.warranty_end) <= in60Days && new Date(a.warranty_end) >= new Date()
  ).length;

  const notVerifiedIn90Days = assets.filter((a) => {
    if (a.status !== "Active") return false;
    const days = (Date.now() - new Date(a.updated_at).getTime()) / 86400000;
    return days > 90;
  }).length;

  function countBy(keyFn: (a: Asset) => string | null): { label: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const a of assets) {
      const key = keyFn(a);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Asset system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">{form.title}</h1>

        <FormAdminNav formId={id} />
        <AssetAdminNav formId={id} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatTile label="Total assets" value={String(total)} icon="📦" />
          <StatTile label="Verified" value={String(verified)} icon="✅" />
          <StatTile label="Unverified" value={String(unverified)} icon="⏳" />
          <StatTile label="Under repair" value={String(underRepair)} icon="🔧" />
          <StatTile label="Unallocated" value={String(unallocated)} icon="📭" />
          <StatTile label="Awaiting acknowledgement" value={String(awaitingAck)} icon="✍️" />
          <StatTile label="Awaiting verification" value={String(awaitingVerification)} icon="🔍" />
          <StatTile label="Lost / stolen" value={String(lostOrStolen)} icon="🚨" />
          <StatTile label="Retired / disposed" value={String(retiredOrDisposed)} icon="🗑️" />
          <StatTile label="Missing serial number" value={String(missingSerial)} icon="❓" />
          <StatTile label="Possible duplicates" value={String(duplicateCount ?? 0)} icon="⚠️" />
          <StatTile label="Warranty expiring (60d)" value={String(warrantyExpiringSoon)} icon="🛡️" />
          <StatTile label="Not verified in 90d" value={String(notVerifiedIn90Days)} icon="🕓" />
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <ChartCard title="By category">
            <BarList data={countBy((a) => categoryName.get(a.category_id ?? "") ?? null)} />
          </ChartCard>
          <ChartCard title="By condition">
            <BarList data={countBy((a) => a.condition)} />
          </ChartCard>
          <ChartCard title="By employee">
            <BarList data={countBy((a) => employeeName.get(a.current_employee_id ?? "") ?? null)} />
          </ChartCard>
          <ChartCard title="By department">
            <BarList data={countBy((a) => a.current_department)} />
          </ChartCard>
          <ChartCard title="By cost centre">
            <BarList data={countBy((a) => a.current_cost_centre)} />
          </ChartCard>
          <ChartCard title="By location">
            <BarList data={countBy((a) => a.current_location)} />
          </ChartCard>
          <ChartCard title="By status">
            <BarList data={countBy((a) => a.status)} />
          </ChartCard>
        </div>
      </div>
    </main>
  );
}
