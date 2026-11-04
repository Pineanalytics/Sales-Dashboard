"use client";

import { useState } from "react";

const inputClass = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-muted-strong outline-none focus:border-primary-blue disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";

/**
 * The questions asked before outlets are disowned: why, and who may own them (team leaders from other teams, each of whom claims or declines) or "unknown" when none of them applies.
 * Used for one outlet on its form and for many chosen in the list.
 */
export function DisownForm({ teamLeaderOptions, busy, errorFor, intro, reasonLabel, submitLabel, onSubmit }: {
  teamLeaderOptions: string[];
  busy: boolean;
  errorFor: (field: string) => string | undefined;
  intro: string;
  reasonLabel: string;
  submitLabel: string;
  onSubmit: (choice: { reason: string; candidates: string[]; ownerUnknown: boolean }) => Promise<boolean> | void;
}) {
  const [reason, setReason] = useState("");
  const [find, setFind] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [ownerUnknown, setOwnerUnknown] = useState(false);
  const shown = teamLeaderOptions.filter((n) => n.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 40);
  const ready = reason.trim().length >= 5 && (ownerUnknown || picked.length > 0);
  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-xs text-muted">{intro}</p>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{reasonLabel}</span>
        <textarea className={inputClass} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        {errorFor("reason") ? <span className="text-xs text-accent-red">{errorFor("reason")}</span> : null}
      </label>
      <label className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-strong">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={ownerUnknown}
          onChange={(e) => {
            setOwnerUnknown(e.target.checked);
            if (e.target.checked) setPicked([]);
          }}
        />
        <span>
          <span className="font-semibold text-brand-navy">Owner unknown</span>
          <span className="block text-xs text-muted">None of the team leaders applies, or I do not know whose it is. No team is asked; the outlet goes to the admin to allocate or close.</span>
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Possible owners (other teams)</span>
        <input className={inputClass} placeholder="Find a team leader" disabled={ownerUnknown} value={find} onChange={(e) => setFind(e.target.value)} />
      </label>
      <div className={`flex max-h-40 flex-wrap gap-2 overflow-auto ${ownerUnknown ? "pointer-events-none opacity-40" : ""}`}>
        {shown.map((name) => (
          <button key={name} type="button" aria-pressed={picked.includes(name)} disabled={ownerUnknown} onClick={() => setPicked(picked.includes(name) ? picked.filter((p) => p !== name) : [...picked, name])} className={`rounded-full border px-3 py-1 text-xs font-semibold ${picked.includes(name) ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}>
            {name}
          </button>
        ))}
      </div>
      {picked.length > 0 ? <p className="text-xs text-muted">Chosen: {picked.join(", ")}</p> : null}
      {ownerUnknown ? <p className="text-xs text-muted">The owner is declared unknown.</p> : null}
      {errorFor("candidates") ? <span className="text-xs text-accent-red">{errorFor("candidates")}</span> : null}
      <div>
        <button className={primaryButton} disabled={busy || !ready} onClick={() => onSubmit({ reason, candidates: picked, ownerUnknown })}>{submitLabel}</button>
      </div>
    </div>
  );
}
