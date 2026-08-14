import Link from "next/link";
import { formatRelativeTime, type PhotoEntry } from "@/lib/dashboard";

export function PhotoGrid({
  photos,
  formId,
}: {
  photos: PhotoEntry[];
  formId: string;
}) {
  if (photos.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-600)]">
        No shelf photos uploaded yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {photos.map((p) => (
        <Link
          key={p.submissionId}
          href={`/admin/forms/${formId}/submissions/${p.submissionId}/edit`}
          className="group block"
        >
          <div className="aspect-square rounded-lg overflow-hidden border border-[var(--line)] bg-[var(--sand-100)]">
            <img
              src={p.url}
              alt={`Shelf at ${p.outlet || "branch"}`}
              className="h-full w-full object-cover group-hover:scale-105 transition-transform"
              loading="lazy"
            />
          </div>
          <p className="mt-1.5 text-xs font-medium text-[var(--ink-900)] truncate">
            {p.outlet || "Unknown branch"}
          </p>
          <p
            className="text-[11px] text-[var(--ink-400)] truncate"
            title={new Date(p.submittedAt).toLocaleString()}
          >
            {p.retailer ? `${p.retailer} · ` : ""}
            {formatRelativeTime(p.submittedAt)}
          </p>
        </Link>
      ))}
    </div>
  );
}
