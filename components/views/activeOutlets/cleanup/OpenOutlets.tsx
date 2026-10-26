"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import type { OpenOutletRow } from "@/lib/outletCleanup/openOutlets";

interface Payload {
  rows: OpenOutletRow[];
  waitingForMe: number;
  overdue: number;
  teamLeaders: string[];
  overdueDays: number;
  isAdmin: boolean;
}

const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";

const STATUS: Record<OpenOutletRow["status"], { label: string; tier: "good" | "warn" | "bad" | "neutral" }> = {
  OPEN: { label: "Waiting for an answer", tier: "warn" },
  CLAIMED: { label: "Claimed", tier: "good" },
  UNCLAIMED: { label: "Declined by all", tier: "bad" },
  CLOSED: { label: "Closed", tier: "neutral" },
};

/** Outlets that were disowned: the teams named as possible owners claim or decline them; an admin allocates what nobody claims. */
export function OpenOutlets({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/outlet-cleanup/open", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the marked open outlets.");
        if (!cancelled) setData(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
    onChanged();
  }, [onChanged]);

  if (error) return <SectionCard title="Marked open outlets"><p className="text-sm text-muted-strong">{error}</p></SectionCard>;
  if (!data) return <SectionCard title="Marked open outlets"><p className="text-sm text-muted">Loading…</p></SectionCard>;

  const waiting = data.rows.filter((r) => r.canRespondAs.length > 0);
  const rest = data.rows.filter((r) => r.canRespondAs.length === 0);
  return (
    <div className="flex flex-col gap-6">
      {waiting.length > 0 ? (
        <SectionCard title={`Waiting for your answer (${waiting.length})`}>
          <p className="mb-3 text-sm text-muted-strong">Another team disowned these outlets and named your team as a possible owner. Claim an outlet that sits in your territory, or decline it. The first claim wins.</p>
          <div className="flex flex-col gap-3">{waiting.map((row) => <OpenCard key={row.id} row={row} data={data} onDone={refresh} />)}</div>
        </SectionCard>
      ) : null}
      <SectionCard title="Marked open outlets" action={data.overdue > 0 ? <span className="text-xs font-semibold text-accent-red">{data.overdue} unsettled for over {data.overdueDays} days</span> : null}>
        {rest.length === 0 ? <p className="text-sm text-muted">{waiting.length > 0 ? "No others." : "No outlet has been marked open."}</p> : null}
        <div className="flex flex-col gap-3">{rest.map((row) => <OpenCard key={row.id} row={row} data={data} onDone={refresh} />)}</div>
      </SectionCard>
    </div>
  );
}

function OpenCard({ row, data, onDone }: { row: OpenOutletRow; data: Payload; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const status = STATUS[row.status];

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/outlet-cleanup/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, ...body }) });
      const result = await response.json();
      if (!response.ok) setMessage(result.error ?? "Failed to save.");
      else onDone();
    } catch {
      setMessage("The answer could not be sent. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const unsettled = row.status === "OPEN" || row.status === "UNCLAIMED";
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-brand-navy">{row.outletName}</p>
          <p className="mt-0.5 text-xs text-muted">{OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source} · {row.principals ?? "-"} · {row.territory ?? "-"}{row.region ? `, ${row.region}` : ""}</p>
          <p className="mt-0.5 text-xs text-muted">Disowned by {row.previousTeamLeader ?? row.markedBy} on {new Date(row.markedAt).toLocaleDateString()}: {row.reason}</p>
        </div>
        <div className="flex items-center gap-2">
          {row.overdue ? <Badge tier="bad">Over {data.overdueDays} days</Badge> : null}
          <Badge tier={status.tier}>{row.claimedBy && row.status === "CLAIMED" ? `Claimed by ${row.claimedBy}` : status.label}</Badge>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {row.candidates.map((c) => (
          <span key={c.teamLeader} className="rounded-full border border-border px-3 py-1 text-xs text-muted-strong">{c.teamLeader}: {c.response === "PENDING" ? "no answer yet" : c.response === "CLAIMED" ? "claimed" : "declined"}</span>
        ))}
      </div>
      {row.resolutionNote ? <p className="mt-2 text-xs text-muted">Admin note: {row.resolutionNote}</p> : null}

      {row.canRespondAs.map((leader) => (
        <div key={leader} className="mt-3 flex flex-wrap items-center gap-2">
          <input aria-label="Note" maxLength={300} placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} className="w-56 rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue" />
          <button className={primaryButton} disabled={busy} onClick={() => send({ action: "respond", response: "CLAIM", teamLeader: leader, note })}>Claim for {leader}</button>
          <button className={ghostButton} disabled={busy} onClick={() => send({ action: "respond", response: "DECLINE", teamLeader: leader, note })}>Decline</button>
        </div>
      ))}

      {data.isAdmin && unsettled ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <select aria-label="Allocate to" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs outline-none">
            <option value="">Allocate to…</option>
            {data.teamLeaders.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className={primaryButton} disabled={busy || assignTo === ""} onClick={() => send({ action: "resolve", decision: "ASSIGN", teamLeader: assignTo, note })}>Allocate</button>
          <input aria-label="Admin note" maxLength={300} placeholder="Note (required to close)" value={note} onChange={(e) => setNote(e.target.value)} className="w-56 rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue" />
          <button className={ghostButton} disabled={busy || note.trim() === ""} onClick={() => send({ action: "resolve", decision: "CLOSE", note })}>Close without an owner</button>
        </div>
      ) : null}
      {message ? <p role="status" className="mt-2 text-xs text-accent-red">{message}</p> : null}
    </div>
  );
}
