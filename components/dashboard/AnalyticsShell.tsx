"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { Session } from "next-auth";
import type { ReactNode } from "react";
import { useDashboardStore } from "@/lib/store";
import type { Dataset } from "@/lib/types";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { GlobalFilterBar } from "./GlobalFilterBar";
import { UserProvider } from "./UserContext";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { EmptyState } from "@/components/ui/EmptyState";
import { DocumentTable20Regular, LockClosed20Regular } from "@fluentui/react-icons";
import { pageKeyForPathname } from "@/lib/pageAccess";

// How often to silently re-check for fresh data while a pane is left open,
// independent of navigation. Matches the cadence of the sales/coverage sync
// jobs closely enough to feel "live" without hammering the DB.

/** Replaces DashboardShell's role: SSR-dataset hydration + the persistent
 *  chrome (Sidebar/Header/GlobalFilterBar) around whichever route is active,
 *  instead of switching between view components in place. */
export function AnalyticsShell({
  initialDataset,
  user,
  children,
}: {
  initialDataset: Dataset | null;
  user: Session["user"] | null;
  children: ReactNode;
}) {
  const storeDataset = useDashboardStore((s) => s.dataset);
  const status = useDashboardStore((s) => s.status);
  const setDataset = useDashboardStore((s) => s.setDataset);
  const fetchLatest = useDashboardStore((s) => s.fetchLatest);
  const pathname = usePathname();
  // Principal KPIs and Coaching have compact, source-specific APIs. They must
  // never make the shell hydrate the portfolio-sized workbook dataset first.
  const requiresDataset = !pathname?.startsWith("/coaching") && !pathname?.startsWith("/principal-kpis");

  // Same fallback pattern as the old DashboardShell: the store starts empty
  // client-side, so render the SSR-provided dataset until the hydration
  // effect below pushes it into the store.
  const dataset = storeDataset ?? initialDataset;

  // Report visibility: a viewer only sees pages their admin explicitly
  // granted (Sidebar.tsx already hides the nav links; this is the actual
  // gate for anyone navigating to a disallowed URL directly).
  const requiredPage = pageKeyForPathname(pathname);
  const isAdmin = user?.role === "ADMIN";
  const pageAllowed = isAdmin || !requiredPage || (user?.allowedPages ?? []).includes(requiredPage);

  useEffect(() => {
    if (initialDataset) {
      setDataset(initialDataset);
      return;
    }
    if (requiresDataset && !storeDataset && status === "idle") void fetchLatest();
  }, [fetchLatest, initialDataset, requiresDataset, setDataset, status, storeDataset]);

  // Auto-refresh on pane navigation: client-side <Link> navigation between
  // routes under this shared layout never re-runs the layout's own SSR fetch
  // (by design, for speed), so without this the only way to see updated data
  // was a full browser refresh. This silently re-fetches via the lightweight
  // /api/dataset route on every route change, preserving whatever period/
  // principal filter the user has set (unlike fetchLatest(), which resets
  // them) — skips the very first render since the SSR-provided dataset is
  // already fresh at that point.
  // Do not re-fetch the complete portfolio snapshot during navigation. It is
  // large enough to starve interactions; live pages use their own small feeds.

  return (
    <UserProvider value={user}>
      <div className="flex flex-1 min-h-0">
        <Sidebar user={user} />
        <div className="flex-1 flex flex-col min-w-0">
          <Header user={user} />
          {requiresDataset ? <GlobalFilterBar /> : null}
          <main className="flex-1 p-3 md:p-4 flex flex-col gap-4">
            {requiresDataset && status === "loading" && !dataset ? (
              <FullPageSpinner label="Processing workbook…" />
            ) : requiresDataset && !dataset ? (
              <EmptyState
                icon={<DocumentTable20Regular className="h-10 w-10" />}
                title="No sales data uploaded yet"
                description="Upload the monthly Excel export to populate revenue, coverage, profitability, stock and forecast views for every principal."
              />
            ) : !pageAllowed ? (
              <EmptyState
                icon={<LockClosed20Regular className="h-10 w-10" />}
                title="You don't have access to this report"
                description="Ask your administrator to grant you access to this page."
              />
            ) : (
              // Keyed by pathname so the fade+slide-up animation re-fires on every route
              // change instead of only on first mount (React would otherwise reuse this div).
              <div key={pathname} className="animate-fade-in flex flex-col gap-4">{children}</div>
            )}
          </main>
        </div>
      </div>
    </UserProvider>
  );
}
