"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MultiSelectOption = { value: string; label: string };

/** Compact checkbox picker for filters that can legitimately have more than one
 * answer. Keeping its selected values controlled lets every caller expose the
 * same Clear action without relying on browser-specific <select multiple> UI.
 *
 * The open panel is rendered through a portal into document.body, positioned
 * from the trigger's own bounding rect, rather than as a normal absolutely-
 * positioned child. A plain `absolute` child here gets visually cut off by any
 * sticky-positioned ancestor sibling elsewhere on the page (e.g. Table.tsx's
 * sticky <thead>) — Chromium gives `position: sticky` table headers their own
 * stacking layer that a same-page `z-50` absolute element can end up trapped
 * beneath, regardless of z-index. Portaling to <body> sidesteps that
 * entirely: the panel is no longer a descendant of anything that could clip
 * or out-stack it. */
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
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = useMemo(() => new Set(value), [value]);
  const visibleOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);
  const summary = value.length === 0 || value.length === options.length ? allLabel : value.length === 1 ? options.find((option) => option.value === value[0])?.label ?? "1 selected" : `${value.length} selected`;

  function toggle(option: string) {
    onChange(selected.has(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom, left: rect.left, width: rect.width });
  };

  // Measure before paint so the panel never flashes at a stale/zero position.
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open]);

  // The trigger can move under the panel from an ancestor scroll (any
  // scrollable container, not just window) or a viewport resize while open.
  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <div className={`relative min-w-[190px] ${className}`}>
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-8 w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-2 text-left text-xs font-semibold normal-case tracking-normal text-foreground outline-none hover:border-primary-blue focus:border-primary-blue"
      >
        <span className="truncate">{summary}</span><span className="text-muted">⌄</span>
      </button>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <div
              style={{ position: "fixed", top: position.top + 4, left: position.left, width: "min(19rem, calc(100vw - 2rem))" }}
              className="z-[100] overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            >
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
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
