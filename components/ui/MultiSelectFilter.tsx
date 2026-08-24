"use client";

import { useMemo, useState } from "react";

export type MultiSelectOption = { value: string; label: string };

/** Compact checkbox picker for filters that can legitimately have more than one
 * answer. Keeping its selected values controlled lets every caller expose the
 * same Clear action without relying on browser-specific <select multiple> UI. */
export function MultiSelectFilter({
  label,
  options,
  value,
  onChange,
  allLabel = "All",
  className = "",
}: {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(value), [value]);
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const summary = value.length === 0 ? allLabel : value.length === 1 ? options.find((option) => option.value === value[0])?.label ?? "1 selected" : `${value.length} selected`;

  function toggle(option: string) {
    onChange(selected.has(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  return (
    <div className={`relative min-w-[190px] ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-2 text-left text-xs font-semibold normal-case tracking-normal text-foreground outline-none hover:border-primary-blue focus:border-primary-blue"
      >
        <span className="truncate">{summary}</span><span className="text-muted">⌄</span>
      </button>
      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-[min(19rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="border-b border-border p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}…`}
              className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary-blue"
            />
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-semibold">
              <button type="button" onClick={() => onChange(options.map((option) => option.value))} className="text-primary-blue hover:underline">Select all</button>
              <button type="button" onClick={() => onChange([])} disabled={value.length === 0} className="text-muted-strong hover:text-brand-orange disabled:opacity-40">Clear</button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1.5">
            {visibleOptions.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-background-elevated">
                <input type="checkbox" checked={selected.has(option.value)} onChange={() => toggle(option.value)} className="accent-primary-blue" />
                <span className="truncate">{option.label}</span>
              </label>
            ))}
            {visibleOptions.length === 0 ? <p className="px-2.5 py-4 text-xs text-muted">No matches.</p> : null}
          </div>
          <div className="flex justify-end border-t border-border p-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-primary-blue px-3 py-1.5 text-xs font-semibold text-white">Done</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
