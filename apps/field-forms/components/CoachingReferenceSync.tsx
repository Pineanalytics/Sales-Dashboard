"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type OutletRun = {
  status: string;
  message?: string | null;
  stats?: Record<string, number> | null;
};

export default function CoachingReferenceSync({ formId }: { formId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [outletsBusy, setOutletsBusy] = useState(false);
  const [outletRun, setOutletRun] = useState<OutletRun | null>(null);
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

  async function loadOutletRun() {
    try {
      const response = await fetch(`/api/admin/coaching-reference-sync/outlets/initial?formId=${encodeURIComponent(formId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setOutletRun(result.run ?? null);
      if (result.run?.status === "completed" || result.run?.status === "failed") setOutletsBusy(false);
    } catch {
      // The primary action reports connection errors; this progress poll is best effort.
    }
  }

  useEffect(() => {
    void loadOutletRun();
    const timer = window.setInterval(() => void loadOutletRun(), 5_000);
    return () => window.clearInterval(timer);
  }, [formId]);

  async function startOutletSync() {
    setOutletsBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/coaching-reference-sync/outlets/initial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Outlet refresh failed.");
      setMessage(result.alreadyRunning ? "The controlled outlet refresh is already running in the background." : "The controlled outlet refresh has started in the background. You can continue using the dashboard.");
      await loadOutletRun();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Outlet refresh failed.");
      setOutletsBusy(false);
    }
  }

  const stats = outletRun?.stats;
  const running = outletsBusy || outletRun?.status === "queued" || outletRun?.status === "running";

  return (
    <section className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--pine-50)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono-label text-[11px] uppercase tracking-wide text-[var(--pine-700)]">Pinefrost Analytics connection</p>
          <p className="mt-1 text-sm text-[var(--ink-600)]">Refresh active principals and the employee roster from the authoritative dashboard. The outlet baseline runs in the background, preserves existing history, and never guesses shared customer IDs across principals.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={syncRoster} disabled={busy || running} className="rounded-md bg-[var(--pine-700)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--pine-900)] disabled:opacity-50">
            {busy ? "Refreshing..." : "Refresh roster"}
          </button>
          <button type="button" onClick={startOutletSync} disabled={busy || running} className="rounded-md border border-[var(--pine-700)] px-4 py-2 text-sm font-medium text-[var(--pine-700)] hover:bg-white disabled:opacity-50">
            {running ? "Refreshing in background..." : "Refresh active outlets safely"}
          </button>
        </div>
      </div>
      {message && <p className="mt-3 text-sm text-[var(--pine-700)]">{message}</p>}
      {outletRun && (
        <p className="mt-2 text-xs text-[var(--ink-600)]">
          Outlet sync: {outletRun.status}. {outletRun.message}
          {stats?.linkedExisting ? ` ${stats.linkedExisting.toLocaleString()} existing outlets linked.` : ""}
          {stats?.created ? ` ${stats.created.toLocaleString()} new outlets added.` : ""}
          {stats?.ambiguousPrincipalRelationships ? ` ${stats.ambiguousPrincipalRelationships.toLocaleString()} shared-customer principal relationships held for review.` : ""}
        </p>
      )}
    </section>
  );
}
