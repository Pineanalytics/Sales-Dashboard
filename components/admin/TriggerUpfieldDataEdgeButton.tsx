"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/** Queues a local DataEdge task start; the source machine polls because the
 * VPS has no inbound route to that machine. */
export function TriggerUpfieldDataEdgeButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function queue() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/upfield-timestamps/trigger", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not queue DataEdge refresh.");
      setMessage(data.alreadyQueued ? "Already queued — waiting for the DataEdge machine." : "Queued — the DataEdge task will start when its next poll runs.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not queue DataEdge refresh.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-2">
    <Button variant="secondary" className="!px-3 !py-1 !text-[11px]" disabled={busy} onClick={queue}>
      {busy ? <Spinner className="h-3 w-3" /> : "Trigger DataEdge"}
    </Button>
    {message ? <span className="text-[10px] text-muted">{message}</span> : null}
  </div>;
}
