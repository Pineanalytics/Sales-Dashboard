"use client";

import { useEffect, useRef } from "react";
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
import { DocumentTable20Regular } from "@fluentui/react-icons";

// How often to silently re-check for fresh data while a pane is left open,
// independent of navigation. Matches the cadence of the sales/coverage sync
// jobs closely enough to feel "live" without hammering the DB.
const AUTO_REFRESH_INTERVAL_MS = 3 * 60 * 1000;

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
  const refreshDataset = useDashboardStore((s) => s.refreshDataset);
  const pathname = usePathname();

  // Same fallback pattern as the old DashboardShell: the store starts empty
  // client-side, so render the SSR-provided dataset until the hydration
  // effect below pushes it into the store.
  const dataset = storeDataset ?? initialDataset;

  useEffect(() => {
    if (initialDataset) setDataset(initialDataset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh on pane navigation: client-side <Link> navigation between
  // routes under this shared layout never re-runs the layout's own SSR fetch
  // (by design, for speed), so without this the only way to see updated data
  // was a full browser refresh. This silently re-fetches via the lightweight
  // /api/dataset route on every route change, preserving whatever period/
  // principal filter the user has set (unlike fetchLatest(), which resets
  // them) — skips the very first render since the SSR-provided dataset is
  // already fresh at that point.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    refreshDataset();
  }, [pathname, refreshDataset]);

  // Belt-and-braces: also refresh periodically for panes left open without
  // further navigation (e.g. a dashboard left up on a screen).
  useEffect(() => {
    const id = setInterval(() => refreshDataset(), AUTO_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshDataset]);

  return (
    <UserProvider value={user}>
      <div className="flex flex-1 min-h-0">
        <Sidebar user={user} />
        <div className="flex-1 flex flex-col min-w-0">
          <Header user={user} />
          <GlobalFilterBar />
          <main className="flex-1 p-4 md:p-6 flex flex-col gap-6">
            {status === "loading" && !dataset ? (
              <FullPageSpinner label="Processing workbook…" />
            ) : !dataset ? (
              <EmptyState
                icon={<DocumentTable20Regular className="h-10 w-10" />}
                title="No sales data uploaded yet"
                description="Upload the monthly Excel export to populate revenue, coverage, profitability, stock and forecast views for every principal."
              />
            ) : (
              <div className="animate-fade-in flex flex-col gap-6">{children}</div>
            )}
          </main>
        </div>
      </div>
    </UserProvider>
  );
}
