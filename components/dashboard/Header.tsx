"use client";

import { useRef, useState } from "react";
import type { Session } from "next-auth";
import {
  Navigation20Regular,
  ArrowUpload20Regular,
  History20Regular,
  Warning20Regular,
  PersonCircle20Regular,
  SignOut20Regular,
  Shield20Regular,
} from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { Spinner } from "@/components/ui/Spinner";
import { formatNumber, formatPercent, trendTier } from "@/lib/format";
import { signOutAction } from "@/app/actions";
import Link from "next/link";

const HERO_BADGE_TIER_CLASS = {
  good: "bg-white/90 text-accent-green",
  warn: "bg-white/90 text-amber-700",
  bad: "bg-white/90 text-accent-red",
  neutral: "bg-white/15 text-white border border-white/30",
} as const;

function HeroBadge({ tier, children }: { tier: keyof typeof HERO_BADGE_TIER_CLASS; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ${HERO_BADGE_TIER_CLASS[tier]}`}>
      {children}
    </span>
  );
}

export function Header({ user }: { user: Session["user"] | null }) {
  const dataset = useDashboardStore((s) => s.dataset);
  const status = useDashboardStore((s) => s.status);
  const error = useDashboardStore((s) => s.error);
  const history = useDashboardStore((s) => s.history);
  const uploadFile = useDashboardStore((s) => s.uploadFile);
  const fetchHistory = useDashboardStore((s) => s.fetchHistory);
  const fetchSnapshot = useDashboardStore((s) => s.fetchSnapshot);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const uploading = status === "loading";
  const isAdmin = user?.role === "ADMIN";

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadFile(file);
  }

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
    <header className="sticky top-0 z-30">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(8,36,94,0.25)]">
        <div className="flex items-start gap-3">
          <button
            className="md:hidden text-white/90 hover:text-white mt-1"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Navigation20Regular />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] md:text-[34px] font-bold text-white leading-tight truncate">
              {dataset?.reportMeta.title || "Sales Performance Dashboard"}
            </h1>
            <p className="text-sm text-white/70 truncate mt-1">
              {dataset
                ? `Uploaded ${new Date(dataset.uploadedAt).toLocaleString()}`
                : "Kenya distributor sales analytics by principal"}
            </p>
          </div>

          <div className="relative shrink-0">
            <button
              onClick={toggleHistory}
              className="hidden sm:inline-flex items-center gap-2 rounded-full border border-white/40 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors duration-300"
            >
              <History20Regular className="h-4 w-4" /> History
            </button>
            {historyOpen ? (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)] overflow-hidden text-foreground">
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
                        className="w-full text-left px-3 py-2 text-xs hover:bg-surface-hover transition-colors border-b border-border/60 last:border-0"
                      >
                        <div className="font-medium truncate">{h.reportTitle}</div>
                        <div className="text-muted">{new Date(h.uploadedAt).toLocaleString()}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {isAdmin ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="shrink-0 inline-flex items-center gap-2 rounded-full bg-button-blue px-4 py-2 text-xs font-semibold text-white hover:bg-button-blue-hover disabled:opacity-60 transition-colors duration-300 shadow-sm"
              >
                {uploading ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUpload20Regular className="h-4 w-4" />}
                {uploading ? "Processing…" : "Upload Excel"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
            </>
          ) : null}

          <div className="relative shrink-0">
            <button
              onClick={toggleAccount}
              className="inline-flex items-center gap-2 rounded-full border border-white/40 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 transition-colors duration-300"
              aria-label="Account menu"
            >
              <PersonCircle20Regular className="h-5 w-5" />
              <span className="hidden md:inline max-w-[120px] truncate">{user?.name || user?.email}</span>
            </button>
            {accountOpen ? (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)] overflow-hidden text-foreground">
                <div className="px-4 py-3 border-b border-border/60">
                  <div className="text-sm font-medium truncate">{user?.name || "Account"}</div>
                  <div className="text-xs text-muted truncate">{user?.email}</div>
                  <span className="mt-2 inline-block rounded-full bg-accent-blue-soft px-2 py-0.5 text-[11px] font-semibold text-accent-blue">
                    {user?.role === "ADMIN" ? "Administrator" : "Viewer"}
                  </span>
                </div>
                {isAdmin ? (
                  <Link
                    href="/admin/users"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs hover:bg-surface-hover transition-colors border-b border-border/60"
                  >
                    <Shield20Regular className="h-4 w-4 text-secondary-blue" />
                    Manage users
                  </Link>
                ) : null}
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-accent-red hover:bg-surface-hover transition-colors"
                  >
                    <SignOut20Regular className="h-4 w-4" />
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>

        {dataset ? (
          <div className="hidden lg:flex items-center gap-2 mt-4">
            <HeroBadge tier={dataset.totals.h1Achieved >= 100 ? "good" : dataset.totals.h1Achieved >= 60 ? "warn" : "bad"}>
              H1 Achieved {formatPercent(dataset.totals.h1Achieved)}
            </HeroBadge>
            <HeroBadge tier={trendTier(dataset.totals.h1Variance)}>
              H1 Variance {dataset.totals.h1Variance > 0 ? "+" : ""}
              {formatNumber(dataset.totals.h1Variance)}
            </HeroBadge>
            <HeroBadge tier="neutral">Coverage: {formatNumber(dataset.covTotal.currentCoverage)} outlets covered</HeroBadge>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mx-4 md:mx-8 mt-3 flex items-center gap-2 rounded-xl border-l-4 border-l-accent-red bg-surface px-3 py-3 text-xs text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <Warning20Regular className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </header>
  );
}
