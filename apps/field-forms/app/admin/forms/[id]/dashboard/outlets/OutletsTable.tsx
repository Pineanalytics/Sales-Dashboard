"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatRelativeTime, type OutletSummary } from "@/lib/dashboard";

type SortKey = "recent" | "visits" | "oos" | "positioning";

export default function OutletsTable({
  formId,
  outlets,
  totalKnownOutlets,
}: {
  formId: string;
  outlets: OutletSummary[];
  totalKnownOutlets: number;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = outlets;
    if (q) {
      list = list.filter(
        (o) =>
          o.outlet.toLowerCase().includes(q) ||
          o.retailer.toLowerCase().includes(q) ||
          o.region.toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    switch (sortKey) {
      case "visits":
        sorted.sort((a, b) => b.visits - a.visits);
        break;
      case "oos":
        sorted.sort(
          (a, b) =>
            (b.oosTotal ? b.oosYes / b.oosTotal : 0) -
            (a.oosTotal ? a.oosYes / a.oosTotal : 0)
        );
        break;
      case "positioning":
        sorted.sort(
          (a, b) => (a.avgPositioning ?? 99) - (b.avgPositioning ?? 99)
        );
        break;
      default:
        sorted.sort(
          (a, b) =>
            new Date(b.lastVisit).getTime() - new Date(a.lastVisit).getTime()
        );
    }
    return sorted;
  }, [outlets, query, sortKey]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-[var(--ink-600)]">
          <span className="font-medium text-[var(--ink-900)]">
            {outlets.length}
          </span>{" "}
          branch{outlets.length === 1 ? "" : "es"} visited
          {totalKnownOutlets > 0 && (
            <>
              {" "}
              of {totalKnownOutlets} known (
              {Math.round((outlets.length / totalKnownOutlets) * 100)}%
              coverage)
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search branch, retailer, region…"
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)] w-56"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
          >
            <option value="recent">Most recent</option>
            <option value="visits">Most visits</option>
            <option value="oos">Highest OOS rate</option>
            <option value="positioning">Worst positioning</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
          No branches match.
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-[var(--line)] rounded-lg">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  Branch
                </th>
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  Retailer
                </th>
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  Region
                </th>
                <th className="text-right font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  Visits
                </th>
                <th className="text-right font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  Avg share
                </th>
                <th className="text-right font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  OOS rate
                </th>
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3 whitespace-nowrap">
                  Last visit
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr
                  key={o.outlet}
                  className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--sand-50)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/forms/${formId}/dashboard/outlets/${encodeURIComponent(o.outlet)}${qs ? `?${qs}` : ""}`}
                      className="font-medium text-[var(--pine-700)] hover:underline"
                    >
                      {o.outlet}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-600)]">
                    {o.retailer || "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-600)]">
                    {o.region || "—"}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {o.visits}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {o.avgSharePct !== null ? `${o.avgSharePct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {o.oosTotal > 0 ? (
                      <span
                        className={
                          o.oosYes / o.oosTotal >= 0.3
                            ? "text-[var(--rust-600)]"
                            : "text-[var(--ink-600)]"
                        }
                      >
                        {Math.round((o.oosYes / o.oosTotal) * 100)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-[var(--ink-600)] whitespace-nowrap"
                    title={new Date(o.lastVisit).toLocaleString()}
                  >
                    {formatRelativeTime(o.lastVisit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
