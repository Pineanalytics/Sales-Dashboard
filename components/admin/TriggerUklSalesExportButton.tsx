"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/** Queues a branch/month on the Server PC; it never starts either Centegy PC. */
export function TriggerUklSalesExportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [branch, setBranch] = useState("NAIROBI");
  const [month, setMonth] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function queue() {
    if (!month) { setMessage("Choose a month first."); return; }
    setSubmitting(true);
    setMessage("Queuing…");
    try {
      const response = await fetch("/api/integrations/ukl/sales-export/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, month }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not queue the selected month.");
      const through = data.partialMonth ? ` through ${data.through}` : "";
      setMessage(data.queued ? `${data.queued} day${data.queued === 1 ? "" : "s"} queued${through}; Server PC processes one each hour.` : "All selected dates are already queued.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue the selected month.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return <Button variant="secondary" className="!py-1 !px-3 !text-[11px]" onClick={() => setOpen(true)}>Trigger export</Button>;

  return <div className="flex flex-wrap items-center gap-2">
    <select className="rounded border border-primary-blue/30 bg-surface px-2 py-1 text-xs" value={branch} disabled={submitting} onChange={(event) => setBranch(event.target.value)}>
      <option value="NAIROBI">Nairobi</option>
      <option value="NYERI">Nyeri</option>
    </select>
    <input type="month" className="rounded border border-primary-blue/30 bg-surface px-2 py-1 text-xs" value={month} disabled={submitting} onChange={(event) => setMonth(event.target.value)} />
    <Button variant="primary" className="!py-1 !px-3 !text-[11px]" disabled={submitting || !month} onClick={queue}>{submitting ? <Spinner className="h-3 w-3" /> : "Queue month"}</Button>
    <button type="button" className="text-xs text-secondary-blue underline" disabled={submitting} onClick={() => setOpen(false)}>Cancel</button>
    {message && <span className="basis-full text-xs text-muted">{message}</span>}
  </div>;
}
