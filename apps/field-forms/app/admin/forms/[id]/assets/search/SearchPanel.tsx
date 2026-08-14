"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Asset } from "@/lib/assetTypes";

export default function SearchPanel({ formId }: { formId: string }) {
  const supabase = createClient();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Asset[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({});
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function search() {
    const term = query.trim();
    if (!term) return;
    setSearching(true);
    setSearched(true);

    const { data: matchingEmployees } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("assigned_form_id", formId)
      .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
    const employeeIds = (matchingEmployees ?? []).map((e) => e.id);

    const orClauses = [
      `asset_number.ilike.%${term}%`,
      `serial_number.ilike.%${term}%`,
      `barcode.ilike.%${term}%`,
      `qr_value.ilike.%${term}%`,
      `imei.ilike.%${term}%`,
      `vehicle_reg.ilike.%${term}%`,
      `current_department.ilike.%${term}%`,
      `current_location.ilike.%${term}%`,
    ];
    if (employeeIds.length > 0) {
      orClauses.push(`current_employee_id.in.(${employeeIds.join(",")})`);
    }

    const { data } = await supabase
      .from("assets")
      .select("*")
      .eq("form_id", formId)
      .or(orClauses.join(","))
      .limit(50);

    const results = (data ?? []) as Asset[];
    const resultEmployeeIds = [...new Set(results.map((a) => a.current_employee_id).filter(Boolean))] as string[];
    const { data: employees } = resultEmployeeIds.length
      ? await supabase.from("profiles").select("id, full_name, email").in("id", resultEmployeeIds)
      : { data: [] };

    setEmployeeNames(Object.fromEntries((employees ?? []).map((e) => [e.id, e.full_name || e.email])));
    setResults(results);
    setSearching(false);
  }

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Asset number, serial, barcode, QR, IMEI, vehicle reg, employee, department, location…"
          className="flex-1 rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
        />
        <button
          onClick={search}
          disabled={searching}
          className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-5 py-2 hover:bg-[var(--pine-900)] disabled:opacity-60"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {searched && results.length === 0 && !searching && (
        <p className="text-sm text-[var(--ink-600)]">No matches.</p>
      )}

      <ul className="space-y-2">
        {results.map((asset) => (
          <li key={asset.id}>
            <Link
              href={`/admin/forms/${formId}/assets/${asset.id}`}
              className="block bg-white border border-[var(--line)] rounded-lg px-4 py-3 hover:border-[var(--pine-500)] text-sm"
            >
              <span className="font-medium text-[var(--ink-900)]">
                {asset.description || asset.asset_number || "Untitled asset"}
              </span>{" "}
              <span className="text-[var(--ink-600)]">
                — {employeeNames[asset.current_employee_id ?? ""] ?? "Unassigned"} · {asset.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
