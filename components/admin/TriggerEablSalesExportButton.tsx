"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function TriggerEablSalesExportButton() {
  const router = useRouter(); const [date, setDate] = useState(""); const [open, setOpen] = useState(false); const [message, setMessage] = useState("");
  async function queue(mode: "SMART" | "DATE") {
    setMessage("Queuing…");
    const res = await fetch("/api/integrations/eabl/sales-export/trigger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "DATE" ? { mode, date } : { mode }) });
    const data = await res.json(); setMessage(res.ok ? (data.alreadyQueued ? "Already queued." : "Queued; the download machine will pick it up within five minutes.") : data.error || "Could not queue export."); router.refresh();
  }
  return <div className="flex flex-wrap items-center gap-2">
    {!open ? <Button variant="secondary" className="!py-1 !px-3 !text-[11px]" onClick={() => setOpen(true)}>Trigger export</Button> : <>
      <Button variant="primary" className="!py-1 !px-3 !text-[11px]" onClick={() => queue("SMART")}>Smart</Button>
      <input type="date" className="rounded border border-primary-blue/30 bg-surface px-2 py-1 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
      <Button variant="secondary" className="!py-1 !px-3 !text-[11px]" disabled={!date} onClick={() => queue("DATE")}>Exact date</Button>
    </>}
    {message && <span className="text-xs text-muted">{message}</span>}
  </div>;
}
