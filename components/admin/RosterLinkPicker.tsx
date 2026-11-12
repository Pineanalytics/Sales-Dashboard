"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Linked = { employeeCode: string; name: string };
type Person = { employeeCode: string; name: string; sapName: string; principal: string; active: boolean; score?: number };

/** For a Leverage, DataEdge or EABL identity on the Rep directory page: which roster employee is this rep? Shows the likeliest
 *  matches by name first, searches the roster by typing, and saves the moment one is picked. */
export function RosterLinkPicker({ source, sourceKey, identityName, initialLinked }: { source: string; sourceKey: string; identityName: string; initialLinked: Linked[] }) {
  const router = useRouter();
  const [linked, setLinked] = useState<Linked[]>(initialLinked);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<{ hits: Person[]; suggestions: Person[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/rep-directory/roster-search?q=${encodeURIComponent(query)}&identityName=${encodeURIComponent(identityName)}`, { cache: "no-store" });
        const data = await response.json();
        if (id !== requestId.current) return;
        if (!response.ok) throw new Error(data.error || "Search failed.");
        setPeople(data as { hits: Person[]; suggestions: Person[] });
      } catch (error) {
        if (id === requestId.current) setMessage({ kind: "error", text: error instanceof Error ? error.message : "Search failed." });
      }
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [open, query, identityName]);

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

  async function send(employeeCode: string, key: string | null) {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/rep-directory/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeCode, source, sourceKey: key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save the link.");
      return true;
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not save the link." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function pick(person: Person) {
    setOpen(false);
    if (await send(person.employeeCode, sourceKey)) {
      setLinked((current) => (current.some((l) => l.employeeCode === person.employeeCode) ? current : [...current, { employeeCode: person.employeeCode, name: person.name }]));
      setMessage({ kind: "ok", text: `Linked to ${person.name}.` });
      router.refresh();
    }
  }

  async function remove(employeeCode: string) {
    if (await send(employeeCode, null)) {
      setLinked((current) => current.filter((l) => l.employeeCode !== employeeCode));
      setMessage({ kind: "ok", text: "Link removed." });
      router.refresh();
    }
  }

  const suggestions = (people?.suggestions ?? []).filter((s) => !linked.some((l) => l.employeeCode === s.employeeCode));
  const hits = (people?.hits ?? []).filter((h) => !linked.some((l) => l.employeeCode === h.employeeCode));

  return (
    <div ref={box} className="relative min-w-[12rem]">
      {linked.map((person) => (
        <p key={person.employeeCode} className="flex items-center gap-1 text-xs">
          <span className="font-semibold text-brand-navy">{person.name}</span>
          <span className="text-muted">({person.employeeCode})</span>
          <button type="button" disabled={saving} onClick={() => remove(person.employeeCode)} className="rounded-full px-1.5 text-[10px] font-semibold text-accent-red hover:bg-accent-red-soft disabled:opacity-50" aria-label={`Remove the link to ${person.name}`}>remove</button>
        </p>
      ))}
      <button type="button" disabled={saving} onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-0.5 rounded-full border border-secondary-blue/30 px-2 py-0.5 text-[10px] font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50">
        {saving ? "Saving…" : linked.length > 0 ? "Add another" : "Match to a roster rep"}
      </button>
      {message ? <p role={message.kind === "error" ? "alert" : "status"} className={`mt-1 text-[10px] ${message.kind === "error" ? "text-accent-red" : "text-muted"}`}>{message.text}</p> : null}

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-[22rem] max-w-[85vw] rounded-xl border border-border bg-surface p-2 shadow-lg">
          {suggestions.length > 0 ? (
            <div className="mb-2">
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Looks like</p>
              {suggestions.map((person) => (
                <button key={person.employeeCode} type="button" disabled={saving} onClick={() => pick(person)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-accent-blue-soft">
                  <span className="text-sm font-semibold text-brand-navy">{person.name}</span> <span className="text-[11px] text-muted">({person.employeeCode}) · {person.principal}</span>
                  <span className="block text-[11px] text-muted">SAP name {person.sapName || "-"}</span>
                </button>
              ))}
            </div>
          ) : null}
          <label className="sr-only" htmlFor={`roster-pick-${source}-${sourceKey}`}>Search the roster</label>
          <input id={`roster-pick-${source}-${sourceKey}`} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the roster by name, SAP name or code" className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none focus:border-secondary-blue" />
          <div className="mt-2 max-h-56 overflow-y-auto">
            {people && hits.length === 0 ? <p className="px-2 py-3 text-xs text-muted">No roster rep matches “{query}”.</p> : null}
            {hits.map((person) => (
              <button key={person.employeeCode} type="button" disabled={saving} onClick={() => pick(person)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-accent-blue-soft">
                <span className="text-sm font-semibold text-brand-navy">{person.name}</span> <span className="text-[11px] text-muted">({person.employeeCode}) · {person.principal}{person.active ? "" : " · inactive"}</span>
                <span className="block text-[11px] text-muted">SAP name {person.sapName || "-"}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
