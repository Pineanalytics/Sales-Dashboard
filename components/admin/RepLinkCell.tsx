"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type RepLinkCellInfo = {
  state: "linked" | "name-only" | "not-linked";
  key: string | null;
  name: string;
  proposal: { key: string; name: string } | null;
  sharedWith: Array<{ employeeCode: string; name: string }>;
  identityActive: boolean | null;
};

type Hit = {
  sourceKey: string;
  displayName: string;
  groupLabel: string | null;
  region: string | null;
  principalHint: string | null;
  branch: string | null;
  loginName: string | null;
  isActive: boolean;
  isFieldRep: boolean;
  lastActivityAt: string | null;
  heldBy: Array<{ employeeCode: string; name: string }>;
};

const SOURCE_WORDS = {
  SAP: { label: "SAP rep", keyLabel: "SlpCode", placeholder: "Search SAP salespeople by name or code" },
  PINE: { label: "SFA (Pine) rep", keyLabel: "Pine ID", placeholder: "Search Pine users by name or ID" },
} as const;

function activity(value: string | null): string {
  if (!value) return "no activity on record";
  return `last active ${new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

/** One inline edit point on a roster row, for either the SFA (Pine) rep or the SAP rep. Shows what the row is linked to, finds the right
 *  rep by typing, and saves the moment one is picked. */
export function RepLinkCell({ employeeCode, source, initial, canEdit }: { employeeCode: string; source: "SAP" | "PINE"; initial: RepLinkCellInfo; canEdit: boolean }) {
  const words = SOURCE_WORDS[source];
  const router = useRouter();
  const [info, setInfo] = useState<RepLinkCellInfo>(initial);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  // Type-ahead: the first look is immediate, later keystrokes wait a moment. Only the newest request may update the list.
  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/rep-directory/search?source=${source}&q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const data = await response.json();
        if (id !== requestId.current) return;
        if (!response.ok) throw new Error(data.error || "Search failed.");
        setHits(data.hits as Hit[]);
      } catch (error) {
        if (id === requestId.current) setMessage({ kind: "error", text: error instanceof Error ? error.message : "Search failed." });
      } finally {
        if (id === requestId.current) setSearching(false);
      }
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query, source]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (box.current && event.target instanceof Node && !box.current.contains(event.target)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const save = useCallback(
    async (sourceKey: string | null, optimistic: Partial<RepLinkCellInfo>) => {
      const before = info;
      setSaving(true);
      setMessage(null);
      setInfo({ ...info, ...optimistic });
      setOpen(false);
      try {
        const response = await fetch("/api/rep-directory/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeCode, source, sourceKey }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save the link.");
        const cell = (source === "SAP" ? data.cells?.sap : data.cells?.pine) as RepLinkCellInfo | undefined;
        if (cell) setInfo(cell);
        const shared = (data.sharedWith as Array<{ name: string }> | undefined) ?? [];
        setMessage({ kind: "ok", text: sourceKey === null ? "Link removed." : shared.length > 0 ? `Linked. Also linked to ${shared.map((s) => s.name).join(", ")}.` : "Linked." });
        router.refresh();
      } catch (error) {
        setInfo(before);
        setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the link." });
      } finally {
        setSaving(false);
      }
    },
    [employeeCode, info, router, source]
  );

  const chip =
    info.state === "linked"
      ? "bg-accent-green-soft text-accent-green"
      : info.state === "name-only"
        ? "bg-accent-amber-soft text-accent-amber"
        : "bg-background-elevated text-muted";
  const chipText = info.state === "linked" ? "Linked" : info.state === "name-only" ? "Name only" : "Not linked";

  return (
    <div ref={box} className="relative min-w-[11rem]">
      <p className="font-medium text-foreground">{info.name || <span className="text-muted">-</span>}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip}`}>{chipText}</span>
        {info.key ? <span className="font-mono text-[10px] text-muted">{words.keyLabel} {info.key}</span> : null}
        {info.sharedWith.length > 0 ? (
          <span className="rounded-full bg-accent-amber-soft px-2 py-0.5 text-[10px] font-semibold text-accent-amber" title={`Also held by ${info.sharedWith.map((s) => `${s.name} (${s.employeeCode})`).join(", ")}`}>
            Shared with {info.sharedWith.length}
          </span>
        ) : null}
        {info.identityActive === false ? <span className="rounded-full bg-background-elevated px-2 py-0.5 text-[10px] font-semibold text-muted">Inactive in source</span> : null}
        {canEdit ? (
          <button type="button" disabled={saving} onClick={() => setOpen((v) => !v)} className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-secondary-blue hover:bg-accent-blue-soft disabled:opacity-50" aria-expanded={open}>
            {saving ? "Saving…" : info.state === "linked" ? "Change" : "Find"}
          </button>
        ) : null}
      </div>
      {canEdit && info.state === "name-only" && info.proposal && !open ? (
        <button
          type="button"
          disabled={saving}
          onClick={() => save(info.proposal!.key, { state: "linked", key: info.proposal!.key, name: info.proposal!.name, proposal: null, identityActive: true })}
          className="mt-1 rounded-full border border-secondary-blue/30 px-2 py-0.5 text-[10px] font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50"
        >
          Link to {info.proposal.name}
        </button>
      ) : null}
      {message ? <p role={message.kind === "error" ? "alert" : "status"} className={`mt-1 text-[10px] leading-tight ${message.kind === "error" ? "text-accent-red" : "text-muted"}`}>{message.text}</p> : null}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[22rem] max-w-[85vw] rounded-xl border border-border bg-surface p-2 shadow-lg">
          <label className="sr-only" htmlFor={`rep-link-${source}-${employeeCode}`}>{words.label}</label>
          <input
            id={`rep-link-${source}-${employeeCode}`}
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={words.placeholder}
            className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-secondary-blue"
          />
          <div className="mt-2 max-h-64 overflow-y-auto">
            {searching && !hits ? <p className="px-2 py-3 text-xs text-muted">Searching…</p> : null}
            {hits && hits.length === 0 ? <p className="px-2 py-3 text-xs text-muted">No {words.label} matches “{query}”. The directory refreshes every 30 minutes.</p> : null}
            {(hits ?? []).map((hit) => {
              const others = hit.heldBy.filter((h) => h.employeeCode !== employeeCode);
              const current = info.key === hit.sourceKey;
              return (
                <button
                  key={hit.sourceKey}
                  type="button"
                  disabled={saving || current}
                  onClick={() => save(hit.sourceKey, { state: "linked", key: hit.sourceKey, name: hit.displayName, proposal: null, identityActive: hit.isActive, sharedWith: others })}
                  className="block w-full rounded-lg px-2 py-2 text-left hover:bg-accent-blue-soft disabled:cursor-default disabled:opacity-60"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-brand-navy">{hit.displayName}</span>
                    <span className="font-mono text-[10px] text-muted">{words.keyLabel} {hit.sourceKey}</span>
                    {!hit.isActive ? <span className="rounded-full bg-background-elevated px-1.5 py-0.5 text-[10px] text-muted">inactive</span> : null}
                    {!hit.isFieldRep ? <span className="rounded-full bg-background-elevated px-1.5 py-0.5 text-[10px] text-muted">not a field rep</span> : null}
                    {current ? <span className="rounded-full bg-accent-green-soft px-1.5 py-0.5 text-[10px] text-accent-green">current</span> : null}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {[hit.groupLabel, hit.region, hit.branch, hit.principalHint].filter(Boolean).join(" · ") || "no group on record"} · {activity(hit.lastActivityAt)}
                  </span>
                  {others.length > 0 ? <span className="mt-0.5 block text-[11px] font-medium text-accent-amber">Already linked to {others.map((o) => `${o.name} (${o.employeeCode})`).join(", ")}. You can still link it.</span> : null}
                </button>
              );
            })}
          </div>
          {info.state === "linked" ? (
            <button type="button" disabled={saving} onClick={() => save(null, { state: "not-linked", key: null, proposal: null, sharedWith: [], identityActive: null })} className="mt-2 w-full rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-accent-red hover:bg-accent-red-soft disabled:opacity-50">
              Remove the link (keeps the name as text)
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
