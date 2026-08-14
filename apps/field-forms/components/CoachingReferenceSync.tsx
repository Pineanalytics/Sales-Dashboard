"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CoachingReferenceSync({ formId }: { formId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outletsBusy, setOutletsBusy] = useState(false);
  const [outletCursor, setOutletCursor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function syncRoster() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/coaching-reference-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Reference refresh failed.");
      const caveats = [
        result.matrixRepCount ? `${result.matrixRepCount} matrix rep(s) left unchanged for review` : "",
        result.unlinkedLeaderCount ? `${result.unlinkedLeaderCount} Team Leader(s) need profile matching` : "",
      ].filter(Boolean);
      setMessage(`Roster refreshed: ${result.principalsCreated} principal(s), ${result.repsCreated} new rep(s), ${result.repsUpdated} updated.` + (caveats.length ? ` ${caveats.join("; ")}.` : ""));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reference refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function syncOutletBatch() {
    setOutletsBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/coaching-reference-sync/outlets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId, cursor: outletCursor ?? undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Outlet refresh failed.");
      setOutletCursor(result.nextCursor ?? null);
      setMessage(`Outlet batch refreshed: ${result.processed} processed (${result.created} new, ${result.updated} updated); ${result.assignmentMatched} matched to a rostered rep.` + (result.nextCursor ? " Select refresh again for the next batch." : " Outlet refresh complete."));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Outlet refresh failed.");
    } finally {
      setOutletsBusy(false);
    }
  }

  return (
    <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--pine-50)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono-label text-[11px] uppercase tracking-wide text-[var(--pine-700)]">Pinefrost Analytics connection</p>
          <p className="mt-1 text-sm text-[var(--ink-600)]">Refresh active principals and the employee roster from the authoritative dashboard. Matrix reporting lines are never guessed.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={syncRoster} disabled={busy || outletsBusy} className="rounded-md bg-[var(--pine-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--pine-900)] disabled:opacity-50">
            {busy ? "Refreshing…" : "Refresh roster"}
          </button>
          <button type="button" onClick={syncOutletBatch} disabled={busy || outletsBusy} className="rounded-md border border-[var(--pine-700)] px-4 py-2 text-sm font-medium text-[var(--pine-700)] hover:bg-white disabled:opacity-50">
            {outletsBusy ? "Refreshing…" : outletCursor ? "Refresh next 250 outlets" : "Refresh active outlets"}
          </button>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-[var(--pine-700)]">{message}</p>}
    </section>
  );
}
