import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import DashboardSubNav from "../../DashboardSubNav";
import { byLabel, getFormFieldsAndRows } from "@/lib/formData";
import {
  buildOutletSummaries,
  buildPhotoFeed,
  effectiveLabel,
  filterByEffectiveValue,
  formatRelativeTime,
} from "@/lib/dashboard";
import { StatTile } from "../../DashboardWidgets";
import { PhotoGrid } from "../../PhotoGrid";

export default async function RetailerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; retailer: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id, retailer: encodedRetailer } = await params;
  const retailerName = decodeURIComponent(encodedRetailer);
  const { from, to } = await searchParams;
  const supabase = await createClient();

  const qsParams = new URLSearchParams();
  if (from) qsParams.set("from", from);
  if (to) qsParams.set("to", to);
  const qs = qsParams.toString() ? `?${qsParams.toString()}` : "";

  const { form, fields, rows } = await getFormFieldsAndRows(supabase, id, { from, to });
  if (!form) notFound();

  const retailer = byLabel(fields, "Retailer Name");
  const retailerOther = byLabel(fields, "Retailer Name (if Other)");
  const location = byLabel(fields, "Retailer Location / Branch");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const merchandiser = byLabel(fields, "Merchandiser Name");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");
  const photo = byLabel(fields, "Shelf Photo");

  if (!retailer) notFound();

  const visits = filterByEffectiveValue(
    rows,
    retailer.id,
    retailerOther?.id,
    retailerName
  ).sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
  );

  if (visits.length === 0) notFound();

  const outlets = location
    ? buildOutletSummaries(visits, {
        location: location.id,
        locationOther: locationOther?.id,
        sharePct: shelfPct?.id,
        oos: oos?.id,
        positioning: positioning?.id,
      })
    : [];

  const shareValues = shelfPct
    ? visits.map((v) => parseFloat(v.answers[shelfPct.id])).filter(isFinite)
    : [];
  const avgShare =
    shareValues.length > 0
      ? shareValues.reduce((a, b) => a + b, 0) / shareValues.length
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
            href={`/admin/forms/${id}/dashboard/retailers${qs}`}
            className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
          >
            ← All retailers
          </Link>
        </div>

        <div className="mb-8">
          <h2 className="font-display text-2xl text-[var(--ink-900)]">
            {retailerName}
          </h2>
          <p className="text-sm text-[var(--ink-600)] mt-1">
            {outlets.length} branch{outlets.length === 1 ? "" : "es"} covered
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-10">
          <StatTile label="Visits" value={String(visits.length)} icon="📋" />
          <StatTile label="Branches covered" value={String(outlets.length)} icon="📍" />
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
        </div>

        {photo && (
          <div className="mb-10">
            <h3 className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-3">
              Shelf photos ({photos.length})
            </h3>
            <PhotoGrid photos={photos} formId={id} />
          </div>
        )}

        {location && (
          <div className="mb-10">
            <h3 className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-3">
              Branches for this retailer
            </h3>
            <div className="overflow-x-auto bg-white border border-[var(--line)] rounded-lg">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                    <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                      Branch
                    </th>
                    <th className="text-right font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                      Visits
                    </th>
                    <th className="text-right font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                      Avg share
                    </th>
                    <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3 whitespace-nowrap">
                      Last visit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {outlets
                    .sort((a, b) => b.visits - a.visits)
                    .map((o) => (
                      <tr
                        key={o.outlet}
                        className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--sand-50)]"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/forms/${id}/dashboard/outlets/${encodeURIComponent(o.outlet)}${qs}`}
                            className="font-medium text-[var(--pine-700)] hover:underline"
                          >
                            {o.outlet}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                          {o.visits}
                        </td>
                        <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                          {o.avgSharePct !== null ? `${o.avgSharePct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="px-4 py-3 text-[var(--ink-600)] whitespace-nowrap">
                          {formatRelativeTime(o.lastVisit)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
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
                    Branch
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    Merchandiser
                  </th>
                  <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                    OOS
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--sand-50)]"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-[var(--ink-600)]">
                      {new Date(v.submittedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      {location
                        ? effectiveLabel(
                            v.answers[location.id],
                            locationOther ? v.answers[locationOther.id] : undefined
                          ) || "—"
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {merchandiser ? v.answers[merchandiser.id] || "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {oos && v.answers[oos.id] === "Yes" ? (
                        <span className="text-[var(--rust-600)] font-medium">Yes</span>
                      ) : oos?.id ? (
                        v.answers[oos.id] || "—"
                      ) : (
                        "—"
                      )}
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
