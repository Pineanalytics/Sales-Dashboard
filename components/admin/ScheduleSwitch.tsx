"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

async function postSchedule(body: { jobs?: string[]; group?: "sap"; enabled: boolean }): Promise<void> {
  const response = await fetch("/api/sync/schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "Could not change the schedule.");
}

/** On/off switch for one job's scheduled runs. Off skips its scheduled slots (the worker notices within about ten seconds);
 *  "Refresh now" keeps working. The page is refreshed afterwards so the status column agrees. */
export function ScheduleSwitch({ job, label, off }: { job: string; label: string; off: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const on = !off;

  async function toggle() {
    setPending(true);
    setError("");
    try {
      await postSchedule({ jobs: [job], enabled: !on });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the schedule.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-1.5 flex flex-col items-start gap-0.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`Scheduled runs for ${label}`}
        disabled={pending}
        onClick={toggle}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-strong disabled:opacity-60"
      >
        <span className={`relative inline-block h-3.5 w-6 rounded-full transition-colors ${on ? "bg-accent-green" : "bg-accent-grey"}`}>
          <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? "left-3" : "left-0.5"}`} />
        </span>
        {pending ? <Spinner className="h-3 w-3" /> : null}
        {`Scheduled runs ${on ? "on" : "off"}`}
      </button>
      {error ? <span className="text-[10px] leading-tight text-red-600" role="alert">{error}</span> : null}
    </div>
  );
}

/** One control for every SAP job: pause or resume all their scheduled runs together. */
export function SapScheduleControl({ total, off }: { total: number; off: number }) {
  const router = useRouter();
  const [pending, setPending] = useState<"" | "pause" | "resume">("");
  const [error, setError] = useState("");
  const allOff = off >= total;
  const allOn = off === 0;

  async function change(enabled: boolean) {
    if (!enabled && !window.confirm("Pause the scheduled runs of every SAP sync job?\n\nSales, SFA sales, purchases, Performance Analysis, P&L, stock, receivables and the SAP rep and item lists will stop refreshing on their own until you resume them. \"Refresh now\" still works for each one.")) return;
    setPending(enabled ? "resume" : "pause");
    setError("");
    try {
      await postSchedule({ group: "sap", enabled });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the schedule.");
    } finally {
      setPending("");
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background-elevated p-3 text-xs">
      <div>
        <div className="font-semibold text-foreground">SAP sync jobs · scheduled runs</div>
        <div className="mt-0.5 text-muted">
          {allOn ? `All ${total} are on and refresh on their schedule.` : allOff ? `All ${total} are paused. Nothing is read from SAP on a schedule; "Refresh now" still works.` : `${total - off} on, ${off} paused.`}
        </div>
        {error ? <div className="mt-1 text-red-600" role="alert">{error}</div> : null}
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="!py-1 !px-3 !text-[11px]" disabled={pending !== "" || allOff} onClick={() => change(false)} icon={pending === "pause" ? <Spinner className="h-3 w-3" /> : undefined}>
          Pause all SAP jobs
        </Button>
        <Button variant="primary" className="!py-1 !px-3 !text-[11px]" disabled={pending !== "" || allOn} onClick={() => change(true)} icon={pending === "resume" ? <Spinner className="h-3 w-3" /> : undefined}>
          Resume all SAP jobs
        </Button>
      </div>
    </div>
  );
}
