import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import DashboardSubNav from "../../DashboardSubNav";
import { byLabel, getFormFieldsAndRows } from "@/lib/formData";
import { buildPhotoFeed, effectiveLabel } from "@/lib/dashboard";
import { StatTile } from "../../DashboardWidgets";
import { PhotoGrid } from "../../PhotoGrid";
import { ShareTrend } from "./ShareTrend";

export default async function OutletDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; outlet: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id, outlet: encodedOutlet } = await params;
  const outletName = decodeURIComponent(encodedOutlet);
  const { from, to } = await searchParams;
  const supabase = await createClient();

  const qsParams = new URLSearchParams();
  if (from) qsParams.set("from", from);
  if (to) qsParams.set("to", to);
  const qs = qsParams.toString() ? `?${qsParams.toString()}` : "";

  const { form, fields, rows } = await getFormFieldsAndRows(supabase, id, { from, to });
  if (!form) notFound();

  const location = byLabel(fields, "Retailer Location / Branch");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const retailer = byLabel(fields, "Retailer Name");
  const retailerOther = byLabel(fields, "Retailer Name (if Other)");
  const region = byLabel(fields, "Region");
  const merchandiser = byLabel(fields, "Merchandiser Name");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");
  const delivery = byLabel(fields, "Delivery Status");
  const poStatus = byLabel(fields, "Purchase Order Status");
  const photo = byLabel(fields, "Shelf Photo");

  if (!location) notFound();

  const visits = rows
    .filter(
      (r) =>
        effectiveLabel(
          r.answers[location.id],
          locationOther ? r.answers[locationOther.id] : undefined
        ) === outletName
    )
    .sort(
      (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );

  if (visits.length === 0) notFound();

  const retailerName = retailer
    ? effectiveLabel(
        visits[0].answers[retailer.id],
        retailerOther ? visits[0].answers[retailerOther.id] : undefined
      )
    : "";
  const regionName = region ? visits[0].answers[region.id] ?? "" : "";

  const shareValues = shelfPct
    ? visits
        .map((v) => ({
          date: v.submittedAt,
          value: parseFloat(v.answers[shelfPct.id]),
        }))
        .filter((p) => isFinite(p.value))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    : [];
  const avgShare =
    shareValues.length > 0
      ? shareValues.reduce((s, p) => s + p.value, 0) / shareValues.length
      : null;

  const oosCount = oos ? visits.filter((v) => v.answers[oos.id] === "Yes").length : 0;
  const oosTotal = oos ? visits.filter((v) => v.answers[oos.id]).length : 0;

  const positioningValues = positioning
    ? visits.map((v) => parseFloat(v.answers[positioning.id])).filter(isFinite)
    : [];
  const avgPositioning =
    positioningValues.length > 0
      ? positioningValues.reduce((a, b) => a + b, 0) / positioningValues.length
      : null;

  const photos =
    photo && location
      ? buildPhotoFeed(visits, photo.id, {
          location: location.id,
          locationOther: locationOther?.id,
          retailer: retailer?.id,
          retailerOther: retailerOther?.id,
        })
      : [];

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Dashboard
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">
          {form.title}
        </h1>

        <FormAdminNav formId={id} />
        <DashboardSubNav formId={id} />

        <div className="mb-6">
          <Link
            href={`/admin/forms/${id}/dashboard/outlets${qs}`}
            className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
          >
            ← All branches
          </Link>
        </div>

        <div className="mb-8">
          <h2 className="font-display text-2xl text-[var(--ink-900)]">
            {outletName}
          </h2>
          <p className="text-sm text-[var(--ink-600)] mt-1">
            {[retailerName, regionName].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          <StatTile label="Visits" value={String(visits.length)} icon="📋" />
          <StatTile
            label="Avg. share of shelf"
            value={avgShare !== null ? `${avgShare.toFixed(1)}%` : "—"}
            icon="📐"
          />
          <StatTile
            label="Out-of-stock rate"
            value={oosTotal > 0 ? `${Math.round((oosCount / oosTotal) * 100)}%` : "—"}
            icon="📦"
          />
          <StatTile
            label="Avg. positioning"
            value={avgPositioning !== null ? `${avgPositioning.toFixed(1)}/5` : "—"}
            icon="🎯"
          />
        </div>

        {shelfPct && (
          <div className="bg-white border border-[var(--line)] rounded-xl p-5 shadow-[0_1px_2px_rgba(11,11,11,0.04)] mb-8">
            <h3 className="font-display text-base text-[var(--ink-900)] mb-4">
              Share of shelf over time
            </h3>
            <ShareTrend points={shareValues} />
          </div>
        )}

        {photo && (
          <div className="mb-10">
            <h3 className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-3">
              Shelf photos ({photos.length})
            </h3>
            <PhotoGrid photos={photos} formId={id} />
          </div>
        )}

        <div>
          <h3 className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-3">
            Visit history
          </h3>
          <div className="overflow-x-auto bg-white border border-[var(--line)] rounded-lg">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3 whitespace-nowrap">
                    Date
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    Merchandiser
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    OOS
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    Positioning
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    Delivery
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    PO status
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr key={v.id} className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--sand-50)]">
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--ink-600)]">
                      {new Date(v.submittedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {merchandiser ? v.answers[merchandiser.id] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {oos && v.answers[oos.id] === "Yes" ? (
                        <span className="text-[var(--rust-600)] font-medium">Yes</span>
                      ) : (
                        oos?.id ? v.answers[oos.id] || "—" : "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {positioning ? v.answers[positioning.id] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {delivery && v.answers[delivery.id] === "Not Delivered" ? (
                        <span className="text-[var(--rust-600)] font-medium">
                          Not Delivered
                        </span>
                      ) : (
                        delivery?.id ? v.answers[delivery.id] || "—" : "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {poStatus ? v.answers[poStatus.id] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Link
                        href={`/admin/forms/${id}/submissions/${v.id}/edit`}
                        className="text-xs font-medium text-[var(--pine-700)] hover:underline"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
