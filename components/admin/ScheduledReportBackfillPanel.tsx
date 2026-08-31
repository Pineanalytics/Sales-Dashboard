"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";

type Run = { id: string; startDate: string; endDate: string; status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED"; requestedAt: string; completedAt: string | null; message: string | null };
const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";

export function ScheduledReportBackfillPanel({ initialRuns }: { initialRuns: Run[] }) {
  const [runs, setRuns] = useState(initialRuns);
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const shown = status === "ALL" ? runs : runs.filter((run) => run.status === status);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/scheduled-reports/backfills", { cache: "no-store" });
      if (response.ok) setRuns((await response.json()).runs);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/scheduled-reports/backfills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate: from, endDate: to }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not queue the report.");
      setRuns((current) => [body.run, ...current]); setMessage("Backfill queued. The Windows report agent will claim it when its authenticated session is available.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not queue the report."); }
    finally { setBusy(false); }
  }

  return <SectionCard title="Manual Daily Sales Report backfill">
    <div className="space-y-4 p-1">
      <p className="text-sm text-muted">Queue an authorised extraction from the Windows report agent. This does not expose browser credentials or MFA details to the dashboard.</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-medium text-muted-strong">From date<input className={inputClass} type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="grid gap-1 text-xs font-medium text-muted-strong">To date<input className={inputClass} type="date" required value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button disabled={busy} className="rounded-lg bg-primary-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? "Queuing…" : "Queue Daily Sales Report"}</button>
      </form>
      {message ? <p className="text-sm text-muted-strong" role="status">{message}</p> : null}
      <div className="flex items-center gap-2"><label className="text-xs font-medium text-muted-strong" htmlFor="backfill-status">Status</label><select id="backfill-status" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="ALL">All</option><option value="QUEUED">Queued</option><option value="RUNNING">Running</option><option value="COMPLETED">Completed</option><option value="FAILED">Failed</option></select></div>
      <div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="pb-2 pr-4">Range</th><th className="pb-2 pr-4">Status</th><th className="pb-2 pr-4">Requested</th><th className="pb-2">Detail</th></tr></thead><tbody>{shown.length ? shown.map((run) => <tr key={run.id} className="border-t border-border/70"><td className="py-2 pr-4">{run.startDate} to {run.endDate}</td><td className="py-2 pr-4 font-medium">{run.status}</td><td className="py-2 pr-4">{new Date(run.requestedAt).toLocaleString()}</td><td className="py-2">{run.message || "—"}</td></tr>) : <tr><td colSpan={4} className="py-4 text-muted">No matching backfill requests.</td></tr>}</tbody></table></div>
    </div>
  </SectionCard>;
}
