"use client";

import { Fragment } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { RETAILER_INFO, REGION_CODES } from "@/lib/codeLookups";

interface Row {
  id: string;
  submittedAt: string;
  submitterEmail: string;
  submitterName: string;
  answers: Record<string, string>;
  merchandiserCode?: string | null;
}

// Derived lookup columns, inserted right after the field they're keyed off.
// The merchandiser code comes from the submission's own stamped
// merchandiser_code_id (the code actually held at the time of the visit),
// not a static name->code table — codes can be reassigned over time.
function derivedColumns(
  fieldLabel: string,
  rawValue: string,
  merchandiserCode?: string | null
): Record<string, string> {
  if (fieldLabel === "Merchandiser Name") {
    return { "Merchandiser Code": merchandiserCode ?? "" };
  }
  if (fieldLabel === "Retailer Name") {
    const info = RETAILER_INFO[rawValue];
    return {
      "Retailer Rank": info ? String(info.rank) : "",
      "Retailer Code": info?.code ?? "",
      "Branch Number": info ? String(info.branchNumber) : "",
    };
  }
  if (fieldLabel === "Region") {
    return { "Region Code": REGION_CODES[rawValue] ?? "" };
  }
  return {};
}

function derivedColumnHeaders(fieldLabel: string): string[] {
  return Object.keys(derivedColumns(fieldLabel, ""));
}

export default function SubmissionsTable({
  formId,
  formTitle,
  fields,
  rows,
}: {
  formId: string;
  formTitle: string;
  fields: { id: string; label: string; field_type?: string }[];
  rows: Row[];
}) {
  function exportCsv() {
    const data = rows.map((r) => {
      const record: Record<string, string> = {
        "Submitted at": new Date(r.submittedAt).toLocaleString(),
        "Submitted by": r.submitterName || r.submitterEmail,
        Email: r.submitterEmail,
      };
      for (const f of fields) {
        const raw = r.answers[f.id] ?? "";
        record[f.label] = raw;
        Object.assign(record, derivedColumns(f.label, raw, r.merchandiserCode));
      }
      return record;
    });

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formTitle.replace(/[^a-z0-9]+/gi, "_")}_submissions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--ink-600)]">
          {rows.length} submission{rows.length === 1 ? "" : "s"}
        </p>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] transition-colors disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="border border-dashed border-[var(--line)] rounded-lg p-10 text-center text-[var(--ink-600)]">
          No submissions yet.
        </div>
      ) : (
        <div className="overflow-x-auto bg-white border border-[var(--line)] rounded-lg">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3 whitespace-nowrap">
                  Submitted
                </th>
                <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3 whitespace-nowrap">
                  By
                </th>
                {fields.map((f) => (
                  <Fragment key={f.id}>
                    <th className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--ink-600)] px-4 py-3 whitespace-nowrap">
                      {f.label}
                    </th>
                    {derivedColumnHeaders(f.label).map((h) => (
                      <th
                        key={`${f.id}-${h}`}
                        className="text-left font-mono-label text-xs uppercase tracking-wide text-[var(--pine-600)] px-4 py-3 whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </Fragment>
                ))}
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--line)] last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-[var(--ink-600)]">
                    {new Date(r.submittedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.submitterName || r.submitterEmail}
                  </td>
                  {fields.map((f) => {
                    const raw = r.answers[f.id] ?? "";
                    const derived = derivedColumns(f.label, raw, r.merchandiserCode);
                    return (
                      <Fragment key={f.id}>
                        <td className="px-4 py-3">
                          {f.field_type === "photo" && raw ? (
                            <a href={raw} target="_blank" rel="noreferrer">
                              <img
                                src={raw}
                                alt="Shelf"
                                className="h-10 w-10 object-cover rounded border border-[var(--line)]"
                              />
                            </a>
                          ) : (
                            raw
                          )}
                        </td>
                        {Object.entries(derived).map(([h, v]) => (
                          <td
                            key={`${f.id}-${h}`}
                            className="px-4 py-3 text-[var(--pine-700)] whitespace-nowrap"
                          >
                            {v || "—"}
                          </td>
                        ))}
                      </Fragment>
                    );
                  })}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/admin/forms/${formId}/submissions/${r.id}/edit`}
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
      )}
    </div>
  );
}
