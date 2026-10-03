"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface FocusedPanelProps {
  title: string;
  subtitle?: string;
  /** Where Close / Esc / a click on the backdrop goes — the page without the panel's query param. */
  closeHref: string;
  /** Drill-through between records without closing the panel. */
  nav?: { position: string; previousHref: string | null; nextHref: string | null };
  children: React.ReactNode;
}

/** Right-hand drawer for editing one record while the list behind it keeps its
 *  scroll position. Server-rendered from a query param so the view is linkable
 *  and a saved form (a server action that redirects) closes it by itself. */
export function FocusedPanel({ title, subtitle, closeHref, nav, children }: FocusedPanelProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [router, closeHref]);

  // Land the cursor in the first field so a mapping can be typed straight away,
  // and restart at the top of the panel when drilling to the next record.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollTop = 0;
    panel.querySelector<HTMLInputElement>("input[name='principal'], input:not([type='hidden']):not([disabled])")?.focus({ preventScroll: true });
  }, [title]);

  const navLink = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft";
  const navDisabled = "rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted/60";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-black/40" onClick={() => router.push(closeHref, { scroll: false })} />
      <div ref={panelRef} className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-surface shadow-[-8px_0_32px_rgba(0,0,0,0.25)]">
        <div className="sticky top-0 z-10 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-primary-blue">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {nav ? (
              <>
                {nav.previousHref ? (
                  <Link href={nav.previousHref} scroll={false} prefetch={false} className={navLink}>← Previous</Link>
                ) : (
                  <span className={navDisabled}>← Previous</span>
                )}
                <span className="text-xs text-muted">{nav.position}</span>
                {nav.nextHref ? (
                  <Link href={nav.nextHref} scroll={false} prefetch={false} className={navLink}>Next →</Link>
                ) : (
                  <span className={navDisabled}>Next →</span>
                )}
              </>
            ) : null}
            <Link href={closeHref} scroll={false} className="rounded-full px-3 py-1.5 text-xs font-semibold text-muted-strong hover:bg-background-elevated">
              Close ✕
            </Link>
          </div>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
