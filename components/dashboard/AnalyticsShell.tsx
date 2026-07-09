"use client";

import { useEffect } from "react";
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

  // Same fallback pattern as the old DashboardShell: the store starts empty
  // client-side, so render the SSR-provided dataset until the hydration
  // effect below pushes it into the store.
  const dataset = storeDataset ?? initialDataset;

  useEffect(() => {
    if (initialDataset) setDataset(initialDataset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
