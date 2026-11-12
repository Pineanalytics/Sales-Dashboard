"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

type Phase = "idle" | "PENDING" | "RUNNING";

const POLL_MS = 4_000;
// Stop watching after this long; the run itself carries on in the worker and the next page load shows its result.
const GIVE_UP_MS = 20 * 60_000;

/** "Refresh now" for one sync job. Queues a run for the worker that owns the job (POST /api/sync/run), then
 *  watches it until it is done and reloads the panel. `initial` restores the waiting state after a page reload. */
export function RefreshSyncButton({ job, label, heavyWarning, initial }: { job: string; label: string; heavyWarning?: string; initial?: "PENDING" | "RUNNING" }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(initial ?? "idle");
  const [message, setMessage] = useState("");
  const startedWatching = useRef(0);

  const poll = useCallback(async () => {
    try {
      const response = await fetch(`/api/sync/run?job=${encodeURIComponent(job)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read the refresh status.");
      const request = data.request as { status: string; resultSummary: string | null } | null;
      if (!request) { setPhase("idle"); return; }
      if (request.status === "PENDING") {
        setPhase("PENDING");
        setMessage(data.unclaimed ? "Not picked up yet. The worker may be busy or restarting." : "Queued. It starts as soon as the worker finishes its current run.");
      } else if (request.status === "RUNNING") {
        setPhase("RUNNING");
        setMessage("Running now…");
      } else if (request.status === "COMPLETED") {
        setPhase("idle");
        setMessage(`Refreshed. ${request.resultSummary ?? ""}`.trim());
        router.refresh();
      } else {
        setPhase("idle");
        setMessage(`Failed: ${request.resultSummary ?? "see the worker log"}`);
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not read the refresh status.");
    }
  }, [job, router]);

  const watching = phase !== "idle";
  useEffect(() => {
    if (!watching) return;
    startedWatching.current = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedWatching.current > GIVE_UP_MS) {
        window.clearInterval(timer);
        setPhase("idle");
        setMessage("Still working. Reload the page later to see the result.");
        return;
      }
      void poll();
    }, POLL_MS);
    const first = window.setTimeout(() => void poll(), 1_500);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [watching, poll]);

  async function start() {
    if (heavyWarning && !window.confirm(`${label}\n\n${heavyWarning}\n\nRefresh it now?`)) return;
    setMessage("Queuing…");
    setPhase("PENDING");
    try {
      const response = await fetch("/api/sync/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not queue the refresh.");
      setMessage(data.alreadyActive ? "A refresh is already queued or running." : "Queued. It starts as soon as the worker finishes its current run.");
    } catch (error) {
      setPhase("idle");
      setMessage(error instanceof Error ? error.message : "Could not queue the refresh.");
    }
  }

  const busy = phase !== "idle";
  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" className="!py-1 !px-3 !text-[11px]" disabled={busy} onClick={start} aria-label={`Refresh ${label} now`}>
        {busy ? <span className="flex items-center gap-1.5"><Spinner className="h-3 w-3" />{phase === "RUNNING" ? "Running…" : "Queued…"}</span> : "Refresh now"}
      </Button>
      {message ? <span className="text-[10px] leading-tight text-muted" role="status">{message}</span> : null}
    </div>
  );
}
