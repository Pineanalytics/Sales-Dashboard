"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ADMIN_SCROLL_KEY, parseSavedScroll, scrollToRestore } from "@/lib/adminScroll";

interface Toast {
  kind: "success" | "error";
  text: string;
}

function ScrollKeeper() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  // Remember where the page was scrolled to when a form is submitted or an
  // in-page link (Edit, Review and map, Cancel…) is clicked.
  useEffect(() => {
    const save = () => {
      try {
        sessionStorage.setItem(ADMIN_SCROLL_KEY, JSON.stringify({ path: window.location.pathname, y: window.scrollY, at: Date.now() }));
      } catch {
        // storage can be unavailable (private window); losing the position is harmless
      }
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) save();
    };
    document.addEventListener("submit", save, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("submit", save, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // Put the scroll position back once the redirect (or in-page navigation) has
  // rendered. Next resets to the top first, so retry across a few frames.
  useEffect(() => {
    let saved = null;
    try {
      saved = parseSavedScroll(sessionStorage.getItem(ADMIN_SCROLL_KEY));
    } catch {
      return;
    }
    const target = scrollToRestore(saved, pathname, Date.now());
    if (target === null) return;
    try {
      sessionStorage.removeItem(ADMIN_SCROLL_KEY);
    } catch {
      // ignore
    }
    const attempt = () => window.scrollTo({ top: target, behavior: "instant" });
    attempt();
    const frame = requestAnimationFrame(attempt);
    const timers = [60, 200, 500].map((delay) => window.setTimeout(attempt, delay));
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach(window.clearTimeout);
    };
  }, [pathname, queryString]);

  // Saves redirect with ?success= / ?error=, whose inline banner sits at the top
  // of the page — out of sight once the scroll position is kept — so surface it
  // as a toast too.
  const success = searchParams.get("success");
  const error = searchParams.get("error");
  const hasMessage = Boolean(success || error);
  const toast: Toast | null =
    hasMessage && dismissedFor !== queryString ? (error ? { kind: "error", text: error } : { kind: "success", text: success as string }) : null;

  useEffect(() => {
    if (!hasMessage) return;
    const timer = window.setTimeout(() => setDismissedFor(queryString), 8000);
    return () => window.clearTimeout(timer);
  }, [hasMessage, queryString]);

  if (!toast) return null;
  return (
    <div
      role="status"
      className={`fixed right-4 top-20 z-[60] flex max-w-sm items-start gap-3 rounded-xl border-l-4 bg-surface px-4 py-3 text-sm shadow-[0_8px_24px_rgba(0,0,0,0.18)] ${
        toast.kind === "error" ? "border-l-accent-red text-accent-red" : "border-l-accent-green text-accent-green"
      }`}
    >
      <span className="flex-1">{toast.text}</span>
      <button type="button" onClick={() => setDismissedFor(queryString)} aria-label="Dismiss" className="text-muted hover:text-foreground">
        ×
      </button>
    </div>
  );
}

export function AdminScrollKeeper() {
  return (
    <Suspense fallback={null}>
      <ScrollKeeper />
    </Suspense>
  );
}
