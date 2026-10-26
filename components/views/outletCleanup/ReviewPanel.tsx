"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { formatNumber } from "@/lib/format";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import type { DuplicateReviewRow, ReviewRow } from "@/lib/outletCleanup/review";

type Kind = "entries" | "duplicates";
interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  teamLeaders?: string[];
}

const STATUSES: { value: string; label: string }[] = [
  { value: "REVIEWED", label: "To review" },
  { value: "VALIDATED", label: "Approved, not applied yet" },
  { value: "APPLIED", label: "Applied" },
  { value: "REJECTED", label: "Sent back" },
];

const TIER: Record<string, "good" | "warn" | "bad" | "neutral"> = { REVIEWED: "warn", VALIDATED: "good", APPLIED: "good", REJECTED: "bad" };
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";
const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";
const inputClass = "rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue";

/** Admin: validate or reject what the teams have saved, then apply it to the Active Outlet universe. */
export function ReviewPanel({ onOpenOutlet }: { onOpenOutlet: (source: string, outletKey: string) => void }) {
  const [kind, setKind] = useState<Kind>("entries");
  const [status, setStatus] = useState("REVIEWED");
  const [teamLeader, setTeamLeader] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<ReviewRow> | Page<DuplicateReviewRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ kind, status, page: String(page) });
    if (query && kind === "entries") params.set("q", query);
    if (teamLeader && kind === "entries") params.set("teamLeader", teamLeader);
    fetch(`/api/outlet-cleanup/review?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the review list.");
        if (!cancelled) {
          setData(body);
          setError(null);
          setSelected([]);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, status, page, query, teamLeader, tick]);

  const decide = useCallback(
    async (decision: "VALIDATE" | "REJECT", ids: string[]) => {
      setBusy(true);
      setMessage(null);
      try {
        const response = await fetch("/api/outlet-cleanup/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, decision, ids, note }) });
        const result = await response.json();
        if (!response.ok) setMessage({ tone: "error", text: result.error ?? "Failed to save." });
        else {
          setMessage({ tone: "ok", text: `${result.count} ${decision === "VALIDATE" ? "validated" : "sent back"}${result.skipped ? `, ${result.skipped} were no longer waiting` : ""}.` });
          setNote("");
          setTick((t) => t + 1);
        }
      } catch {
        setMessage({ tone: "error", text: "The decision could not be sent. Check the connection and try again." });
      } finally {
        setBusy(false);
      }
    },
    [kind, note]
  );

  const applyNow = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/outlet-universe/rebuild", { method: "POST" });
      const result = await response.json();
      if (!response.ok) setMessage({ tone: "error", text: result.error ?? "The universe could not be recompiled." });
      else {
        setMessage({ tone: "ok", text: `The universe was recompiled (${formatNumber(result.total)} rows). Approved work is now in it.` });
        setTick((t) => t + 1);
      }
    } catch {
      setMessage({ tone: "error", text: "The recompile did not finish. It may still be running; check again in a minute." });
    } finally {
      setBusy(false);
    }
  };

  const rows = (data?.rows ?? []) as (ReviewRow | DuplicateReviewRow)[];
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const waiting = status === "REVIEWED";
  const cleanIds = kind === "entries" ? (rows as ReviewRow[]).filter((r) => r.flags.length === 0).map((r) => r.id) : rows.map((r) => r.id);

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Review the cleanup"
        action={<button className={primaryButton} disabled={busy} onClick={applyNow}>{busy ? "Working…" : "Apply approved work to the universe now"}</button>}
      >
        <p className="text-sm text-muted-strong">
          Check what the teams have saved. A validated entry is laid over the Active Outlet universe whenever it is compiled (within 30 minutes of someone opening it, or when you press the button) and then shows as applied. Validated identification, GPS and reps replace the source system&apos;s values; a claimed marked-open outlet moves to its new team leader; a validated &quot;same shop&quot; call joins two outlets into one shop, and &quot;not a duplicate&quot; separates them.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {(["entries", "duplicates"] as const).map((k) => (
            <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setPage(1); }} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${kind === k ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}>
              {k === "entries" ? "Outlet entries" : "Duplicate calls"}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {STATUSES.map((s) => (
            <button key={s.value} aria-pressed={status === s.value} onClick={() => { setStatus(s.value); setPage(1); }} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${status === s.value ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}>
              {s.label}
            </button>
          ))}
          {kind === "entries" ? (
            <>
              <select aria-label="Team leader" value={teamLeader} onChange={(e) => { setTeamLeader(e.target.value); setPage(1); }} className={`${inputClass} ml-auto`}>
                <option value="">All team leaders</option>
                {((data as Page<ReviewRow> | null)?.teamLeaders ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <input aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search outlet or key" className={`${inputClass} w-52`} />
            </>
          ) : null}
        </div>
        {message ? <p role="status" className={`mt-3 text-sm ${message.tone === "ok" ? "text-accent-green" : "text-accent-red"}`}>{message.text}</p> : null}
      </SectionCard>

      <SectionCard title={`${STATUSES.find((s) => s.value === status)?.label ?? ""} (${formatNumber(data?.total ?? 0)})`}>
        {error ? <p className="text-sm text-muted-strong">{error}</p> : null}
        {!data && !error ? <p className="text-sm text-muted">Loading…</p> : null}
        {waiting && rows.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button className={ghostButton} onClick={() => setSelected(cleanIds)}>Select all without flags</button>
            <button className={ghostButton} onClick={() => setSelected(rows.map((r) => r.id))}>Select all on this page</button>
            <button className={primaryButton} disabled={busy || selected.length === 0} onClick={() => decide("VALIDATE", selected)}>Validate selected ({selected.length})</button>
            <input aria-label="Reason for sending back" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (needed to send back)" className={`${inputClass} w-64`} />
            <button className={ghostButton} disabled={busy || selected.length === 0 || note.trim() === ""} onClick={() => decide("REJECT", selected)}>Send selected back</button>
          </div>
        ) : null}
        <div className="flex flex-col gap-3">
          {kind === "entries"
            ? (rows as ReviewRow[]).map((row) => <EntryCard key={row.id} row={row} checked={selected.includes(row.id)} selectable={waiting} onToggle={() => toggle(row.id)} onOpen={() => onOpenOutlet(row.source, row.outletKey)} />)
            : (rows as DuplicateReviewRow[]).map((row) => <DuplicateCard key={row.id} row={row} checked={selected.includes(row.id)} selectable={waiting} onToggle={() => toggle(row.id)} />)}
          {data && rows.length === 0 ? <p className="text-sm text-muted">Nothing here.</p> : null}
        </div>
        {data && data.pageCount > 1 ? (
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>Page {data.page} of {data.pageCount}</span>
            <div className="flex gap-2">
              <button className={ghostButton} disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>← Previous</button>
              <button className={ghostButton} disabled={data.page >= data.pageCount} onClick={() => setPage(data.page + 1)}>Next →</button>
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}

function EntryCard({ row, checked, selectable, onToggle, onOpen }: { row: ReviewRow; checked: boolean; selectable: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label className="flex items-start gap-3">
          {selectable ? <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1" aria-label={`Select ${row.outletName}`} /> : null}
          <span>
            <span className="block text-sm font-bold text-brand-navy">{row.outletName}</span>
            <span className="block text-xs text-muted">{OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source} · {row.outletKey} · {row.teamLeader ?? "no team leader"} · saved by {row.reviewedBy ?? "-"}{row.reviewedAt ? ` on ${new Date(row.reviewedAt).toLocaleDateString()}` : ""}</span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          {row.flags.map((flag) => <Badge key={flag} tier="warn">{flag}</Badge>)}
          <Badge tier={TIER[row.status] ?? "neutral"}>{row.status.toLowerCase()}</Badge>
          <button className={ghostButton} onClick={onOpen}>Open outlet</button>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm text-muted-strong">
        {row.changes.map((c) => <li key={c.field}><span className="font-semibold">{c.label}:</span> {c.from && c.from !== c.to ? <>{c.from} → <strong>{c.to}</strong></> : <strong>{c.to}</strong>}{c.from === c.to ? " (confirmed)" : ""}</li>)}
        {row.geo ? <li><span className="font-semibold">GPS:</span> {row.geo.from ? `${row.geo.from} → ` : "new point "}<strong>{row.geo.to}</strong>{row.geo.accuracyM !== null ? ` (fix ${Math.round(row.geo.accuracyM)} m)` : ""}{row.geo.distanceM !== null ? `, ${row.geo.distanceM} m from the old point` : ""}</li> : null}
        {row.reps.map((r) => <li key={r.principal}><span className="font-semibold">{r.principal}:</span> {r.action === "CHANGED" ? <>{r.from ?? "no rep"} → <strong>{r.to}</strong></> : <>{r.to} confirmed</>}</li>)}
        {row.confirmed.length > 0 ? <li><span className="font-semibold">Confirmed as correct:</span> {row.confirmed.join(", ")}</li> : null}
        {row.changes.length === 0 && !row.geo && row.reps.length === 0 && row.confirmed.length === 0 ? <li className="text-muted">No field changes.</li> : null}
      </ul>
      {row.adminNote ? <p className="mt-2 text-xs text-muted">Admin note: {row.adminNote}</p> : null}
    </div>
  );
}

function DuplicateCard({ row, checked, selectable, onToggle }: { row: DuplicateReviewRow; checked: boolean; selectable: boolean; onToggle: () => void }) {
  const side = (o: DuplicateReviewRow["a"]) => `${o.outletName} (${OUTLET_SOURCE_LABELS[o.source as OutletSource] ?? o.source} ${o.outletKey}${o.principals ? `, ${o.principals}` : ""}${o.territory ? `, ${o.territory}` : ""})`;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <label className="flex items-start gap-3">
          {selectable ? <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1" aria-label="Select this decision" /> : null}
          <span>
            <span className="block text-sm font-bold text-brand-navy">{row.decision === "MERGE" ? "Same shop: merge" : "Not a duplicate"}</span>
            <span className="block text-xs text-muted">{row.teamLeader ?? "-"} · {row.decidedBy} on {new Date(row.decidedAt).toLocaleDateString()}</span>
          </span>
        </label>
        <Badge tier={TIER[row.status] ?? "neutral"}>{row.status.toLowerCase()}</Badge>
      </div>
      <p className="mt-3 text-sm text-muted-strong">{side(row.a)}</p>
      <p className="text-sm text-muted-strong">{side(row.b)}</p>
      {row.note ? <p className="mt-2 text-xs text-muted">Note: {row.note}</p> : null}
    </div>
  );
}
