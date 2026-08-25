"use client";

import { useMemo, useState } from "react";
import { O360, fmtKES, fmtNum } from "./theme";
import { O360AgeBadge, O360ReturnBadge } from "./primitives";

export interface BacklogRow {
  ref: string;
  date: string;
  customer: string;
  fsr: string;
  amount: number;
  age: number;
  owner: string;
  erpPrefix?: string | null;
  principal?: string | null;
  stage?: string;
  returned?: boolean;
  returnType?: string | null;
}

interface Column {
  key: keyof BacklogRow;
  label: string;
}

/** Sortable, searchable backlog table — mirrors the reference dashboard's
 *  buildBacklogTable(), rebuilt as a real React component instead of innerHTML
 *  string assembly. Used for every stage's "pending orders" list plus the
 *  master Action Items view. */
export function BacklogTable({ rows, showStage = false, showOwner = true, showReturnStatus = false, showClearanceAssignment = false, stageLabel }: { rows: BacklogRow[]; showStage?: boolean; showOwner?: boolean; showReturnStatus?: boolean; showClearanceAssignment?: boolean; stageLabel?: (stage: string) => string }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof BacklogRow>("amount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const columns: Column[] = useMemo(() => {
    const cols: Column[] = [{ key: "ref", label: "Order Ref" }, { key: "date", label: "Order Date" }, { key: "customer", label: "Customer" }, { key: "fsr", label: "FSR" }];
    if (showStage) cols.push({ key: "stage", label: "Stuck At" });
    if (showClearanceAssignment) cols.push({ key: "erpPrefix", label: "ERP #" }, { key: "principal", label: "Principal" });
    cols.push({ key: "amount", label: "Amount" }, { key: "age", label: "Age (days)" });
    if (showReturnStatus) cols.push({ key: "returned", label: "Status" });
    if (showOwner) cols.push({ key: "owner", label: "Responsible" });
    return cols;
  }, [showStage, showOwner, showReturnStatus, showClearanceAssignment]);

  const filtered = useMemo(() => {
    let data = rows;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      data = data.filter((r) => `${r.ref} ${r.customer} ${r.fsr} ${r.owner} ${r.principal ?? ""} ${r.erpPrefix ?? ""} ${r.stage ?? ""}`.toLowerCase().includes(q));
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      const an = Number(av) || 0;
      const bn = Number(bv) || 0;
      return sortDir === "asc" ? an - bn : bn - an;
    });
  }, [rows, query, sortKey, sortDir]);

  function toggleSort(key: keyof BacklogRow) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "amount" || key === "age" ? "desc" : "asc");
    }
  }

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search ref, customer, FSR or owner..."
        className="mb-2.5 w-full max-w-sm rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] text-white placeholder:text-white/35 outline-none focus:border-white/25"
      />
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.04]">
              {columns.map((c) => (
                <th key={c.key} onClick={() => toggleSort(c.key)} className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 font-semibold ${O360.textMuted} hover:text-white/80`}>
                  {c.label} <span className="text-[10px]">{sortKey === c.key ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={`px-3 py-6 text-center text-[12px] ${O360.textMuted}`}>No matching orders.</td>
              </tr>
            ) : (
              filtered.slice(0, 300).map((r) => (
                <tr key={`${r.ref}-${r.stage ?? ""}`} className="border-b border-white/[0.06] last:border-0 hover:bg-white/[0.03]">
                  {columns.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-2 text-white/80">
                      {c.key === "amount" ? fmtKES(r.amount) : c.key === "age" ? <O360AgeBadge age={r.age} /> : c.key === "returned" ? <O360ReturnBadge returned={r.returned} returnType={r.returnType} /> : c.key === "stage" ? (stageLabel ? stageLabel(String(r.stage ?? "")) : r.stage) : c.key === "customer" ? <span className="max-w-[220px] truncate" title={r.customer}>{r.customer}</span> : String(r[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className={`mt-1.5 text-[11px] ${O360.textFaint}`}>
        Showing {fmtNum(Math.min(filtered.length, 300))} of {fmtNum(rows.length)} orders in this backlog{filtered.length > 300 ? " (narrow your search to see more)" : ""}.
      </div>
    </div>
  );
}
