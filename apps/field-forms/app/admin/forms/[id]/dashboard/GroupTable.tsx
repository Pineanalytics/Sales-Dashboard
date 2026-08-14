"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { GroupSummary } from "@/lib/dashboard";
import { formatRelativeTime } from "@/lib/dashboard";

type SortKey = "recent" | "visits" | "oos" | "positioning";

export default function GroupTable({
  groups,
  basePath,
  nameLabel,
  outletsLabel,
  codeByKey,
}: {
  formId: string;
  groups: GroupSummary[];
  basePath: string;
  nameLabel: string;
  outletsLabel: string;
  codeByKey?: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = groups;
    if (q) list = list.filter((g) => g.key.toLowerCase().includes(q));
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
  }, [groups, query, sortKey]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm text-[var(--ink-600)]">
          <span className="font-medium text-[var(--ink-900)]">{groups.length}</span>{" "}
          {nameLabel.toLowerCase()}
          {groups.length === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${nameLabel.toLowerCase()}…`}
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
          No {nameLabel.toLowerCase()}s match.
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-[var(--line)] rounded-lg">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  {nameLabel}
                </th>
                <th className="text-right font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3">
                  {outletsLabel}
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
              {filtered.map((g) => (
                <tr
                  key={g.key}
                  className="border-b border-[var(--line)] last:border-0 hover:bg-[var(--sand-50)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`${basePath}/${encodeURIComponent(g.key)}${qs ? `?${qs}` : ""}`}
                      className="font-medium text-[var(--pine-700)] hover:underline"
                    >
                      {g.key}
                    </Link>
                    {codeByKey?.[g.key] && (
                      <span className="ml-2 text-xs font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 bg-[var(--pine-100)] text-[var(--pine-700)]">
                        {codeByKey[g.key]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {g.uniqueOutlets}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {g.visits}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {g.avgSharePct !== null ? `${g.avgSharePct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right [font-variant-numeric:tabular-nums]">
                    {g.oosTotal > 0 ? (
                      <span
                        className={
                          g.oosYes / g.oosTotal >= 0.3
                            ? "text-[var(--rust-600)]"
                            : "text-[var(--ink-600)]"
                        }
                      >
                        {Math.round((g.oosYes / g.oosTotal) * 100)}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-600)] whitespace-nowrap">
                    {formatRelativeTime(g.lastVisit)}
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
