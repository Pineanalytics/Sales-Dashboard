"use client";

import { useState } from "react";
import type { Session } from "next-auth";
import Image from "next/image";
import Link from "next/link";
import {
  Navigation20Regular,
  History20Regular,
  Warning20Regular,
  PersonCircle20Regular,
  SignOut20Regular,
  Shield20Regular,
} from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { signOutAction } from "@/app/actions";
import { SearchBar } from "./SearchBar";

export function Header({ user }: { user: Session["user"] | null }) {
  const dataset = useDashboardStore((s) => s.dataset);
  const error = useDashboardStore((s) => s.error);
  const history = useDashboardStore((s) => s.history);
  const fetchHistory = useDashboardStore((s) => s.fetchHistory);
  const fetchSnapshot = useDashboardStore((s) => s.fetchSnapshot);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const isAdmin = user?.role === "ADMIN";

  function toggleHistory() {
    if (!historyOpen) fetchHistory();
    setHistoryOpen((v) => !v);
    setAccountOpen(false);
  }

  function toggleAccount() {
    setAccountOpen((v) => !v);
    setHistoryOpen(false);
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 shadow-[0_2px_12px_rgba(11,61,53,0.08)] backdrop-blur">
      <div className="h-1 bg-gradient-to-r from-brand-navy via-secondary-blue to-brand-leaf" />
      <div className="flex items-center gap-3 px-4 py-3 md:px-8 md:py-3.5">
        <button
          className="shrink-0 text-primary-blue md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Navigation20Regular />
        </button>

        <Link href="/dashboard" className="flex min-w-0 items-center gap-3 shrink-0" aria-label="Pinefrost Analytics home">
          <Image
            src="/brand/pinefrost-distribution-logo.png"
            alt="Pinefrost Distribution"
            width={1472}
            height={723}
            priority
            className="hidden h-9 w-auto object-contain sm:block"
          />
          <span className="hidden border-l border-border pl-3 text-[13px] font-semibold tracking-[0.01em] text-primary-blue lg:block whitespace-nowrap">
            Pinefrost Analytics
          </span>
        </Link>

        <SearchBar />

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="relative">
            <button
              onClick={toggleHistory}
              className="hidden items-center gap-2 rounded-full border border-border px-3.5 py-2 text-xs font-semibold text-muted-strong transition-colors hover:border-secondary-blue hover:bg-surface-hover hover:text-primary-blue sm:inline-flex"
            >
              <History20Regular className="h-4 w-4 text-secondary-blue" /> History
            </button>
            {historyOpen ? (
              <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-2xl bg-surface text-foreground shadow-[0_12px_28px_rgba(11,61,53,0.18)] ring-1 ring-border">
                <div className="max-h-72 overflow-y-auto">
                  {history.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted">No snapshot history yet.</p>
                  ) : (
                    history.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => {
                          fetchSnapshot(h.id);
                          setHistoryOpen(false);
                        }}
                        className="w-full border-b border-border/60 px-3 py-2 text-left text-xs transition-colors last:border-0 hover:bg-surface-hover"
                      >
                        <div className="truncate font-medium">{h.reportTitle}</div>
                        <div className="text-muted">{new Date(h.uploadedAt).toLocaleString()}</div>
                      </button>
                    ))
                  )}
                </div>
                {isAdmin ? (
                  <Link href="/admin/dataset" onClick={() => setHistoryOpen(false)} className="block border-t border-border/60 px-3 py-2.5 text-xs font-semibold text-primary-blue transition-colors hover:bg-surface-hover">
                    View all in Admin →
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              onClick={toggleAccount}
              className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-xs font-semibold text-muted-strong transition-colors hover:border-secondary-blue hover:bg-surface-hover hover:text-primary-blue"
              aria-label="Account menu"
            >
              <PersonCircle20Regular className="h-5 w-5 text-secondary-blue" />
              <span className="hidden max-w-[120px] truncate md:inline">{user?.name || user?.email}</span>
            </button>
            {accountOpen ? (
              <div className="absolute right-0 z-50 mt-2 w-64 overflow-hidden rounded-2xl bg-surface text-foreground shadow-[0_12px_28px_rgba(11,61,53,0.18)] ring-1 ring-border">
                <div className="border-b border-border/60 px-4 py-3">
                  <div className="truncate text-sm font-medium">{user?.name || "Account"}</div>
                  <div className="truncate text-xs text-muted">{user?.email}</div>
                  <span className="mt-2 inline-block rounded-full bg-accent-blue-soft px-2 py-0.5 text-[11px] font-semibold text-accent-blue">
                    {{ ADMIN: "Administrator", TEAM_LEADER: "Team Leader", SUPERVISOR: "Sales Supervisor", VIEWER: "Viewer" }[user?.role ?? "VIEWER"]}
                  </span>
                </div>
                {isAdmin ? (
                  <Link href="/admin" onClick={() => setAccountOpen(false)} className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5 text-xs transition-colors hover:bg-surface-hover">
                    <Shield20Regular className="h-4 w-4 text-secondary-blue" /> Admin
                  </Link>
                ) : null}
                <form action={signOutAction}>
                  <button type="submit" className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-accent-red transition-colors hover:bg-accent-red-soft">
                    <SignOut20Regular className="h-4 w-4" /> Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {dataset ? (
        <div className="hidden border-t border-border bg-background-elevated px-4 py-1 text-[11px] text-muted md:block md:px-8">
          Last data refreshed at {new Date(dataset.uploadedAt).toLocaleString()}
        </div>
      ) : null}

      {error ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border-l-4 border-l-accent-red bg-surface px-3 py-3 text-xs text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)] md:mx-8">
          <Warning20Regular className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </header>
  );
}
