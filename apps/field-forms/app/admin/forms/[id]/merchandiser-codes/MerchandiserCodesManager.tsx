"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Code {
  id: string;
  code: string;
  email: string | null;
  is_active: boolean;
}

interface Assignment {
  id: string;
  merchandiser_code_id: string;
  person_name: string;
  effective_from: string;
  effective_to: string | null;
}

interface ReassignmentRequest {
  id: string;
  person_name: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  requested_by: string;
  current_code_id: string | null;
  requested_code_id: string;
  profiles: { email: string; full_name: string | null } | null;
}

interface EligibleUser {
  id: string;
  label: string;
  fullLabel: string;
}

const inputClass =
  "w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]";

export default function MerchandiserCodesManager({
  formId,
  codes,
  assignments,
  requests,
  eligibleUsers,
}: {
  formId: string;
  codes: Code[];
  assignments: Assignment[];
  requests: ReassignmentRequest[];
  eligibleUsers: EligibleUser[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [reassignName, setReassignName] = useState<Record<string, string>>({});
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentByCode = new Map(
    assignments.filter((a) => a.effective_to === null).map((a) => [a.merchandiser_code_id, a])
  );
  const historyByCode = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = historyByCode.get(a.merchandiser_code_id) ?? [];
    list.push(a);
    historyByCode.set(a.merchandiser_code_id, list);
  }
  const codeById = new Map(codes.map((c) => [c.id, c.code]));
  const pendingRequests = requests.filter((r) => r.status === "pending");
  const currentCodeByPersonName = new Map(
    [...currentByCode.entries()].map(([codeId, a]) => [a.person_name, codeById.get(codeId)])
  );

  async function reassign(codeId: string) {
    const name = (reassignName[codeId] ?? "").trim();
    if (!name) {
      setError("Select who this code is being assigned to.");
      return;
    }
    const current = currentByCode.get(codeId);
    if (current?.person_name === name) {
      setError(`${name} already holds this code.`);
      return;
    }
    setBusy(codeId);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    // A person holds exactly one code at a time — close both the code
    // being vacated here and any other code this same person currently
    // holds, so reassigning never leaves them on two codes at once.
    const toClose = [...currentByCode.values()].filter(
      (a) => a.id === current?.id || a.person_name === name
    );
    for (const a of toClose) {
      const { error: closeErr } = await supabase
        .from("merchandiser_assignments")
        .update({ effective_to: now })
        .eq("id", a.id);
      if (closeErr) {
        setBusy(null);
        setError(closeErr.message);
        return;
      }
    }

    const { error: insErr } = await supabase.from("merchandiser_assignments").insert({
      form_id: formId,
      merchandiser_code_id: codeId,
      person_name: name,
      effective_from: now,
      assigned_by: data.user?.id,
    });
    setBusy(null);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setReassignName((prev) => ({ ...prev, [codeId]: "" }));
    router.refresh();
  }

  async function reviewRequest(request: ReassignmentRequest, approve: boolean) {
    setBusy(request.id);
    setError(null);
    const { data } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    if (approve) {
      // Close whoever currently holds the requester's old code and
      // whoever currently holds the target code (they're being relieved),
      // then open a fresh assignment for the requester on the target code.
      const toClose = [request.current_code_id, request.requested_code_id]
        .filter((id): id is string => !!id)
        .map((id) => currentByCode.get(id))
        .filter((a): a is Assignment => !!a);
      for (const a of toClose) {
        const { error: closeErr } = await supabase
          .from("merchandiser_assignments")
          .update({ effective_to: now })
          .eq("id", a.id);
        if (closeErr) {
          setBusy(null);
          setError(closeErr.message);
          return;
        }
      }
      const { error: insErr } = await supabase.from("merchandiser_assignments").insert({
        form_id: formId,
        merchandiser_code_id: request.requested_code_id,
        person_name: request.person_name,
        effective_from: now,
        assigned_by: data.user?.id,
      });
      if (insErr) {
        setBusy(null);
        setError(insErr.message);
        return;
      }
    }

    const { error: reviewErr } = await supabase
      .from("merchandiser_reassignment_requests")
      .update({
        status: approve ? "approved" : "rejected",
        reviewed_by: data.user?.id,
        reviewed_at: now,
      })
      .eq("id", request.id);
    setBusy(null);
    if (reviewErr) {
      setError(reviewErr.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}

      {pendingRequests.length > 0 && (
        <div className="bg-white border border-[var(--rust-600)] rounded-lg p-5">
          <h2 className="font-display text-base text-[var(--rust-600)] mb-3">
            Pending reassignment requests
          </h2>
          <ul className="space-y-3">
            {pendingRequests.map((r) => (
              <li key={r.id} className="text-sm border-b border-[var(--line)] last:border-0 pb-3 last:pb-0">
                <p className="text-[var(--ink-900)]">
                  <span className="font-medium">{r.person_name}</span>
                  {" "}({r.profiles?.email ?? "unknown"}) requests to move from{" "}
                  <span className="font-medium">
                    {r.current_code_id ? codeById.get(r.current_code_id) ?? "—" : "—"}
                  </span>{" "}
                  to <span className="font-medium">{codeById.get(r.requested_code_id) ?? "—"}</span>.
                </p>
                {r.reason && <p className="text-[var(--ink-600)] mt-0.5">Reason: {r.reason}</p>}
                <div className="flex gap-2 mt-2">
                  <button
                    disabled={busy === r.id}
                    onClick={() => reviewRequest(r, true)}
                    className="rounded-md bg-[var(--pine-700)] text-white text-xs font-medium px-3 py-1.5 hover:bg-[var(--pine-900)] disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy === r.id}
                    onClick={() => reviewRequest(r, false)}
                    className="rounded-md border border-[var(--line)] text-xs font-medium px-3 py-1.5 hover:border-[var(--rust-600)] hover:text-[var(--rust-600)] disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-[var(--line)] rounded-lg p-5">
        <h2 className="font-display text-base text-[var(--ink-900)] mb-4">Codes</h2>
        <div className="space-y-4">
          {codes.map((c) => {
            const current = currentByCode.get(c.id);
            const history = (historyByCode.get(c.id) ?? []).filter((a) => a.effective_to !== null);
            return (
              <div key={c.id} className="border border-[var(--line)] rounded-md p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <span className="font-display text-lg text-[var(--ink-900)]">{c.code}</span>
                    <span className="text-xs text-[var(--ink-400)] ml-2">{c.email}</span>
                  </div>
                  <span className="text-sm text-[var(--ink-600)]">
                    Currently: <span className="font-medium text-[var(--ink-900)]">{current?.person_name ?? "Unassigned"}</span>
                  </span>
                </div>
                <div className="flex gap-2">
                  <select
                    value={reassignName[c.id] ?? ""}
                    onChange={(e) => setReassignName((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    className={inputClass}
                  >
                    <option value="">Select a registered user…</option>
                    {eligibleUsers.map((u) => {
                      const heldCode = currentCodeByPersonName.get(u.label);
                      return (
                        <option key={u.id} value={u.label}>
                          {u.fullLabel}
                          {heldCode && heldCode !== c.code ? ` (currently ${heldCode})` : ""}
                        </option>
                      );
                    })}
                  </select>
                  <button
                    disabled={busy === c.id}
                    onClick={() => reassign(c.id)}
                    className="shrink-0 rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-60"
                  >
                    {current ? "Reassign" : "Assign"}
                  </button>
                </div>
                {history.length > 0 && (
                  <>
                    <button
                      onClick={() => setExpandedHistory(expandedHistory === c.id ? null : c.id)}
                      className="mt-2 text-xs font-medium text-[var(--pine-700)] hover:underline"
                    >
                      {expandedHistory === c.id ? "Hide history" : `History (${history.length})`}
                    </button>
                    {expandedHistory === c.id && (
                      <ul className="mt-2 text-xs text-[var(--ink-600)] space-y-1">
                        {history.map((h) => (
                          <li key={h.id}>
                            {h.person_name}: {new Date(h.effective_from).toLocaleDateString()} –{" "}
                            {h.effective_to ? new Date(h.effective_to).toLocaleDateString() : "present"}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
