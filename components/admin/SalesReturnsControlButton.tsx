"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export interface SalesReturnsControlState {
  desiredMode: string;
  status: string;
  requestedAt: Date | null;
  acknowledgedAt: Date | null;
  resultSummary: string | null;
}

export function SalesReturnsControlButton({
  distributor,
  control,
}: {
  distributor: string;
  control?: SalesReturnsControlState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const catchupOnly = control?.desiredMode === "CATCHUP";
  const pending = control?.status === "PENDING";
  const failed = control?.status === "FAILED";

  async function changeMode(desiredMode: "SMART" | "CATCHUP") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/sales-returns/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distributor, desiredMode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the branch control.");
      setMessage(
        desiredMode === "CATCHUP"
          ? "VPS guard active; waiting for branch acknowledgement."
          : "Smart repair requested; waiting for branch acknowledgement."
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the branch control.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-[190px] flex-col items-start gap-1">
      <Button
        variant={catchupOnly ? "secondary" : "danger"}
        className="!px-3 !py-1 !text-[11px]"
        disabled={busy}
        onClick={() => changeMode(catchupOnly ? "SMART" : "CATCHUP")}
      >
        {busy ? <Spinner className="h-3 w-3" /> : catchupOnly ? "Resume Smart repair" : "Stop backfill"}
      </Button>
      <span className={`text-[10px] ${control?.status === "FAILED" ? "text-brand-orange" : "text-muted"}`}>
        {message ||
          (catchupOnly
            ? failed
              ? "VPS guard active · last machine run failed"
              : pending
              ? "Historical uploads blocked · machine ACK pending"
              : "Live 5-minute catchup only"
            : "Smart historical repair enabled")}
      </span>
    </div>
  );
}
