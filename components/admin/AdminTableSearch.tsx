"use client";

import { useState } from "react";

/** Instant, client-side search over a server-rendered admin list. The list's
 *  container carries `data-filter-root="<target>"`; each filterable row carries
 *  `data-search` (its lower-cased text, see searchText in AdminPage). Rows that
 *  don't match are hidden, which leaves any form fields inside them in the
 *  form, unchanged. Every word typed must appear in the row. */
export function AdminTableSearch({ target, placeholder = "Search…", className = "" }: { target: string; placeholder?: string; className?: string }) {
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<{ shown: number; total: number } | null>(null);

  function applyFilter(value: string) {
    setQuery(value);
    const root = document.querySelector(`[data-filter-root="${target}"]`);
    if (!root) return;
    const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-search]"));
    let shown = 0;
    for (const row of rows) {
      const text = row.dataset.search ?? "";
      const match = words.every((word) => text.includes(word));
      row.hidden = !match;
      if (match) shown += 1;
    }
    setCounts(words.length > 0 ? { shown, total: rows.length } : null);
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="search"
        value={query}
        onChange={(event) => applyFilter(event.target.value)}
        // The box often sits inside a page's form (e.g. Stock cover targets): Enter must filter, never submit it.
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-full border border-border bg-background px-4 py-1.5 text-sm text-foreground outline-none placeholder:text-muted focus:border-secondary-blue sm:w-64"
      />
      {counts ? (
        <span className={`shrink-0 text-xs ${counts.shown === 0 ? "font-semibold text-accent-amber" : "text-muted"}`}>
          {counts.shown === 0 ? "No matches" : `${counts.shown} of ${counts.total}`}
        </span>
      ) : null}
    </div>
  );
}
