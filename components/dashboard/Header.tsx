"use client";

import { useRef, useState } from "react";
import type { Session } from "next-auth";
import Image from "next/image";
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
import { signOutAction } from "@/app/actions";
import { SearchBar } from "./SearchBar";
import Link from "next/link";

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
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-3.5 md:py-4 shadow-[0_2px_10px_rgba(10,31,82,0.25)] flex items-center gap-3">
        <button
          className="md:hidden text-white/90 hover:text-white shrink-0"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
        >
          <Navigation20Regular />
        </button>

        <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0">
          <Image
            src="/pinefrost-logo.png"
            alt="Pinefrost Limited"
            width={1014}
            height={810}
            className="hidden sm:block h-9 w-auto rounded-md object-contain"
          />
          <span className="hidden lg:block text-[15px] font-bold text-white leading-tight whitespace-nowrap">
            Pinefrost Analytics
          </span>
        </Link>

        <SearchBar />

        <div className="flex items-center gap-2 ml-auto shrink-0">
          <div className="relative">
            <button
              onClick={toggleHistory}
              className="hidden sm:inline-flex items-center gap-2 rounded-full border border-white/40 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 hover:border-brand-orange hover:text-brand-orange transition-colors duration-300"
            >
              <History20Regular className="h-4 w-4" /> History
            </button>
            {historyOpen ? (
              <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)] overflow-hidden text-foreground z-50">
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
                <Link
                  href="/reports"
                  onClick={() => setHistoryOpen(false)}
                  className="block px-3 py-2.5 text-xs font-semibold text-primary-blue hover:bg-surface-hover transition-colors border-t border-border/60"
                >
                  View all in Reports →
                </Link>
              </div>
            ) : null}
          </div>

          {isAdmin ? (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="shrink-0 inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-3.5 py-2 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-60 transition-all duration-300 shadow-sm"
              >
                {uploading ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUpload20Regular className="h-4 w-4" />}
                <span className="hidden sm:inline">{uploading ? "Processing…" : "Upload Excel"}</span>
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

          <div className="relative">
            <button
              onClick={toggleAccount}
              className="inline-flex items-center gap-2 rounded-full border border-white/40 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10 hover:border-brand-orange hover:text-brand-orange transition-colors duration-300"
              aria-label="Account menu"
            >
              <PersonCircle20Regular className="h-5 w-5" />
              <span className="hidden md:inline max-w-[120px] truncate">{user?.name || user?.email}</span>
            </button>
            {accountOpen ? (
              <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.16)] overflow-hidden text-foreground z-50">
                <div className="px-4 py-3 border-b border-border/60">
                  <div className="text-sm font-medium truncate">{user?.name || "Account"}</div>
                  <div className="text-xs text-muted truncate">{user?.email}</div>
                  <span className="mt-2 inline-block rounded-full bg-accent-blue-soft px-2 py-0.5 text-[11px] font-semibold text-accent-blue">
                    {user?.role === "ADMIN" ? "Administrator" : "Viewer"}
                  </span>
                </div>
                {isAdmin ? (
                  <Link
                    href="/admin"
                    onClick={() => setAccountOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs hover:bg-surface-hover transition-colors border-b border-border/60"
                  >
                    <Shield20Regular className="h-4 w-4 text-secondary-blue" />
                    Admin
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
      </div>

      {dataset ? (
        <div className="hidden md:block bg-dark-navy/95 px-4 md:px-8 py-1 text-[11px] text-white/60 truncate">
          {dataset.reportMeta.title} — Uploaded {new Date(dataset.uploadedAt).toLocaleString()}
        </div>
      ) : null}

      {error ? (
        <div className="mx-4 md:mx-8 mt-3 flex items-center gap-2 rounded-xl border-l-4 border-l-accent-red bg-surface px-3 py-3 text-xs text-accent-red shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <Warning20Regular className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </header>
  );
}
