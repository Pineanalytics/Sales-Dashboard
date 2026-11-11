"use client";

import { useMemo, useState } from "react";

/** Which principals a login is limited to. "All principals" saves an empty list (unrestricted, the default); "Only selected"
 *  narrows every report to the ticked ones. Submits one hidden "principals" input per pick (plus "principalsSubmitted"). */
export function PrincipalPicker({
  knownPrincipals,
  selected,
  onChange,
  ownPrincipals,
}: {
  knownPrincipals: string[];
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** The principals the login's linked employee code is actively assigned to, offered as a one-click limit. */
  ownPrincipals: string[];
}) {
  const [restricted, setRestricted] = useState(selected.size > 0);
  const [query, setQuery] = useState("");
  // A stored principal that is no longer in the reference list still shows, so it can be seen and unticked.
  const options = useMemo(() => Array.from(new Set([...knownPrincipals, ...selected])).sort((a, b) => a.localeCompare(b)), [knownPrincipals, selected]);
  const normalized = query.trim().toLowerCase();
  const visible = normalized ? options.filter((p) => p.toLowerCase().includes(normalized)) : options;

  function toggle(principal: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(principal);
    else next.delete(principal);
    onChange(next);
  }

  const segment = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold transition-colors ${active ? "bg-primary-blue text-white shadow-sm" : "text-muted-strong hover:text-primary-blue"}`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-background-elevated p-0.5" role="group" aria-label="Principal limit">
          <button
            type="button"
            aria-pressed={!restricted}
            onClick={() => {
              setRestricted(false);
              onChange(new Set());
            }}
            className={segment(!restricted)}
          >
            All principals
          </button>
          <button type="button" aria-pressed={restricted} onClick={() => setRestricted(true)} className={segment(restricted)}>
            Only selected{selected.size > 0 ? ` (${selected.size})` : ""}
          </button>
        </div>
        {ownPrincipals.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setRestricted(true);
              onChange(new Set(ownPrincipals));
            }}
            title={ownPrincipals.join(", ")}
            className="rounded-full border border-secondary-blue/30 px-3 py-1 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft"
          >
            Their own principals ({ownPrincipals.length})
          </button>
        ) : null}
      </div>

      {restricted ? (
        <>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Filter ${options.length} principals…`}
            aria-label="Filter principals"
            className="w-full rounded-full border border-border bg-surface px-3 py-1.5 text-xs outline-none placeholder:text-muted focus:border-secondary-blue sm:max-w-xs"
          />
          <div className="grid max-h-44 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-xl border border-border/70 bg-surface p-2 sm:grid-cols-3 lg:grid-cols-4">
            {visible.length === 0 ? (
              <span className="col-span-full px-1 py-2 text-xs text-muted">No principal matches “{query}”.</span>
            ) : (
              visible.map((principal) => (
                <label key={principal} className="flex min-w-0 cursor-pointer items-center gap-1.5 text-xs text-muted-strong">
                  <input
                    type="checkbox"
                    checked={selected.has(principal)}
                    onChange={(event) => toggle(principal, event.target.checked)}
                    className="h-3.5 w-3.5 shrink-0 rounded border-border text-primary-blue focus:ring-secondary-blue"
                  />
                  <span className="truncate" title={principal}>
                    {principal}
                  </span>
                </label>
              ))
            )}
          </div>
          {selected.size === 0 ? <p className="text-[11px] font-medium text-accent-amber">Tick at least one principal — with none ticked this login stays unrestricted.</p> : null}
        </>
      ) : (
        <p className="text-xs text-muted">Sees every principal.</p>
      )}

      <input type="hidden" name="principalsSubmitted" value="1" />
      {[...selected].map((principal) => (
        <input key={principal} type="hidden" name="principals" value={principal} />
      ))}
    </div>
  );
}
