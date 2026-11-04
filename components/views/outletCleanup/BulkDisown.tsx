"use client";

import { useEffect, useState } from "react";
import { DisownForm } from "./DisownForm";

const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";

export interface SelectedOutlet {
  source: string;
  outletKey: string;
}

export interface BulkDisownResult {
  count: number;
  ownerUnknown: boolean;
  skipped: { outletKey: string; outletName: string; reason: string }[];
}

/** The bar shown while outlets are ticked in the list: disown them all with one reason and one answer to who may own them. */
export function BulkDisown({ selected, repName, onClear, onDone }: { selected: SelectedOutlet[]; repName: string; onClear: () => void; onDone: (result: BulkDisownResult) => void }) {
  const [open, setOpen] = useState(false);
  const [teamLeaders, setTeamLeaders] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ field: string; message: string }[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || teamLeaders) return;
    let cancelled = false;
    fetch("/api/outlet-cleanup/disown", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the team leaders.");
        if (!cancelled) setTeamLeaders(body.teamLeaders as string[]);
      })
      .catch((error: Error) => {
        if (!cancelled) setMessage(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, teamLeaders]);

  const submit = async (choice: { reason: string; candidates: string[]; ownerUnknown: boolean }): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    setErrors([]);
    try {
      const response = await fetch("/api/outlet-cleanup/disown", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: selected.map((s) => ({ source: s.source, outletKey: s.outletKey })), ...choice }) });
      const result = await response.json();
      if (!response.ok) {
        setErrors(result.fields ?? []);
        setMessage(result.error ?? "Failed to save.");
        return false;
      }
      setOpen(false);
      onDone(result as BulkDisownResult);
      return true;
    } catch {
      setMessage("The outlets could not be disowned. Check the connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (field: string) => errors.find((e) => e.field === field)?.message;
  const count = selected.length;
  return (
    <section aria-label="Disown the chosen outlets" className="sticky bottom-3 z-10 mt-4 rounded-xl border border-primary-blue/40 bg-surface p-4 shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-brand-navy">{count} outlet{count === 1 ? "" : "s"} chosen{repName ? ` for ${repName}` : ""}</span>
        <button className={primaryButton} disabled={busy || count === 0} onClick={() => setOpen(!open)}>{open ? "Cancel" : `Disown ${count}`}</button>
        <button className={ghostButton} disabled={busy} onClick={onClear}>Clear selection</button>
      </div>
      {message ? <p role="status" className="mt-2 text-xs text-accent-red">{message}</p> : null}
      {open && teamLeaders ? (
        <DisownForm
          teamLeaderOptions={teamLeaders}
          busy={busy}
          errorFor={errorFor}
          intro={`These ${count} outlets move to Marked open outlets together. Name the team leaders from other teams who may own them; each can claim or decline every outlet. If none of them applies, declare the owner unknown and an admin will allocate them.`}
          reasonLabel="Why are they not yours?"
          submitLabel={`Mark ${count} as open`}
          onSubmit={submit}
        />
      ) : null}
      {open && !teamLeaders && !message ? <p className="mt-2 text-xs text-muted">Loading the team leaders…</p> : null}
    </section>
  );
}
