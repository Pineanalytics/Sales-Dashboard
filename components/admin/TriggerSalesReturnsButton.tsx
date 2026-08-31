"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

type Mode = "idle" | "form" | "submitting" | "done" | "error";

/** "Trigger now" for one Sales & Returns branch, from the Sync Health panel
 *  on /admin/dataset — see SalesReturnsTriggerRequest's schema comment for
 *  why this has to be a queue rather than a direct remote call (the Centegy
 *  machines have no inbound network access at all). Queues via
 *  POST /api/sales-returns/trigger; the actual run happens on whichever
 *  machine's own poll (scripts/sales-returns-trigger-poll.ps1) next checks
 *  in, so this only ever confirms "queued," never "done" — refresh the page
 *  after a few minutes to see the branch's row go Fresh again. */
export function TriggerSalesReturnsButton({ distributor, label }: { distributor: string; label: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [window_, setWindow] = useState<"today" | "yesterday" | "catchup" | "backfill">("catchup");
  const [backfillDate, setBackfillDate] = useState("");
  const [message, setMessage] = useState("");

  async function submit() {
    if (window_ === "backfill" && !backfillDate) {
      setMode("error");
      setMessage("Pick a backfill date first.");
      return;
    }
    setMode("submitting");
    try {
      const res = await fetch("/api/sales-returns/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(window_ === "backfill" ? { distributor, backfillFrom: backfillDate } : { distributor, window: window_ }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to queue the trigger.");
      setMode("done");
      setMessage(data.alreadyQueued ? "Already queued — waiting for the branch machine to pick it up." : "Queued — will run within a few minutes.");
      router.refresh();
    } catch (err) {
      setMode("error");
      setMessage(err instanceof Error ? err.message : "Failed to queue the trigger.");
    }
  }

  if (mode === "idle") {
    return (
      <Button variant="secondary" className="!py-1 !px-3 !text-[11px]" onClick={() => setMode("form")}>
        Trigger now
      </Button>
    );
  }

  if (mode === "done" || mode === "error") {
    return <span className={`text-xs ${mode === "error" ? "text-brand-orange" : "text-emerald-500"}`}>{message}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="rounded border border-primary-blue/30 bg-surface px-2 py-1 text-xs"
        value={window_}
        disabled={mode === "submitting"}
        onChange={(e) => setWindow(e.target.value as typeof window_)}
      >
        <option value="catchup">Catchup (yesterday + today — safest)</option>
        <option value="today">Today only</option>
        <option value="yesterday">Yesterday only</option>
        <option value="backfill">Repair one selected day...</option>
      </select>
      {window_ === "backfill" && (
        <input
          type="date"
          className="rounded border border-primary-blue/30 bg-surface px-2 py-1 text-xs"
          value={backfillDate}
          disabled={mode === "submitting"}
          onChange={(e) => setBackfillDate(e.target.value)}
        />
      )}
      <Button variant="primary" className="!py-1 !px-3 !text-[11px]" disabled={mode === "submitting"} onClick={submit}>
        {mode === "submitting" ? <Spinner className="h-3 w-3" /> : `Queue for ${label}`}
      </Button>
      <button type="button" className="text-xs text-secondary-blue underline" disabled={mode === "submitting"} onClick={() => setMode("idle")}>
        Cancel
      </button>
    </div>
  );
}
