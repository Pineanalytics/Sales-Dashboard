"use client";

import { useState } from "react";
import { routeNameFromLocations } from "@/lib/outletCleanup/validate";

const inputClass = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-muted-strong outline-none focus:border-primary-blue";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";
const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";

/** Names a new route. Pick the major locations it covers (up to three) and the name is built from them ("Imara Daima-Fedha"); the name can still be adjusted. */
export function RouteBuilder({ teamLeader, locations, onCreated, onCancel }: { teamLeader: string; locations: string[]; onCreated: (name: string) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [edited, setEdited] = useState(false);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = locations.filter((l) => l.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 40);
  const toggle = (place: string) => {
    const next = picked.includes(place) ? picked.filter((p) => p !== place) : picked.length < 3 ? [...picked, place] : picked;
    setPicked(next);
    if (!edited) setName(routeNameFromLocations(next));
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/outlet-cleanup/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ teamLeader, name, locations: picked }) });
      const result = await response.json();
      if (!response.ok) setError(result.error ?? "Failed to save.");
      else onCreated(result.route.name);
    } catch {
      setError("The route could not be saved. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border bg-background-elevated p-3">
      <p className="text-xs text-muted">Name the route after the major locations it covers. Choose up to three; the name is built from them and you can adjust it. The route belongs to {teamLeader}.</p>
      <input className={inputClass} placeholder="Find a location" value={find} onChange={(e) => setFind(e.target.value)} />
      <div className="flex max-h-36 flex-wrap gap-2 overflow-auto">
        {shown.map((place) => (
          <button key={place} type="button" aria-pressed={picked.includes(place)} onClick={() => toggle(place)} className={`rounded-full border px-3 py-1 text-xs font-semibold ${picked.includes(place) ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}>
            {place}
          </button>
        ))}
        {shown.length === 0 ? <span className="text-xs text-muted">No matching location.</span> : null}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Route name</span>
        <input
          className={inputClass}
          maxLength={60}
          value={name}
          placeholder="Imara Daima-Fedha"
          onChange={(e) => {
            setName(e.target.value);
            setEdited(true);
          }}
        />
      </label>
      {error ? <p className="text-xs text-accent-red">{error}</p> : null}
      <div className="flex gap-2">
        <button type="button" className={primaryButton} disabled={busy || name.trim().length < 3} onClick={create}>Create route</button>
        <button type="button" className={ghostButton} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
