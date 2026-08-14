"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const inputClass =
  "w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]";
const labelClass = "block text-sm font-medium text-[var(--ink-900)] mb-1.5";

export default function RequestForm({
  formId,
  codes,
  currentCodeId,
  currentCodeLabel,
  personName,
}: {
  formId: string;
  codes: { id: string; code: string }[];
  currentCodeId: string | null;
  currentCodeLabel: string | null;
  personName: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [requestedCodeId, setRequestedCodeId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!requestedCodeId) {
      setError("Please choose the code you'd like to move to.");
      return;
    }
    if (requestedCodeId === currentCodeId) {
      setError("That's already your current code.");
      return;
    }
    setBusy(true);
    setError(null);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setBusy(false);
      setError("You must be signed in.");
      return;
    }
    const { error: err } = await supabase.from("merchandiser_reassignment_requests").insert({
      form_id: formId,
      requested_by: data.user.id,
      person_name: personName,
      current_code_id: currentCodeId,
      requested_code_id: requestedCodeId,
      reason: reason.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
    router.refresh();
  }

  if (sent) {
    return (
      <div className="bg-white border border-[var(--line)] rounded-lg p-5 text-sm text-[var(--pine-700)]">
        Request sent — a supervisor will review it.
      </div>
    );
  }

  return (
    <div className="bg-white border border-[var(--line)] rounded-lg p-5 space-y-4">
      <p className="text-sm text-[var(--ink-600)]">
        Requesting as <span className="font-medium text-[var(--ink-900)]">{personName}</span>
        {" "}— current code: <span className="font-medium text-[var(--ink-900)]">{currentCodeLabel ?? "Unassigned"}</span>
      </p>
      <div>
        <label className={labelClass}>Requested code</label>
        <select
          value={requestedCodeId}
          onChange={(e) => setRequestedCodeId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select…</option>
          {codes
            .filter((c) => c.id !== currentCodeId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>
      {error && (
        <p className="text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={submit}
        className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-2.5 hover:bg-[var(--pine-900)] disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send request"}
      </button>
    </div>
  );
}
