"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Summary {
  show: boolean;
  name: string | null;
  role: string;
  period: string;
  teams: number;
  outlets: number;
  reviewed: number;
  pctReviewed: number;
  missingGeo: number;
  targetPct: number;
  attainment: number | null;
  rank: number | null;
  rankedTeams: number;
  waitingForMe: number;
}

/** The reminder a team leader or supervisor sees every time the dashboard opens (a login or a refresh): where the cleanup stands and a way in. */
export function CleanupReminder({ role }: { role: string | null | undefined }) {
  const eligible = role === "TEAM_LEADER" || role === "SUPERVISOR";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const startRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    fetch("/api/outlet-cleanup/summary", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: Summary | null) => {
        if (!cancelled && body?.show) {
          setSummary(body);
          setOpen(true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  useEffect(() => {
    if (!open) return;
    startRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open || !summary) return null;
  const toDo = Math.max(0, summary.outlets - summary.reviewed);
  const month = new Date(`${summary.period}-01T00:00:00`).toLocaleDateString(undefined, { month: "long" });
  const onTrack = summary.pctReviewed >= summary.targetPct;

  return (
    <div className="no-print fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-labelledby="cleanup-reminder-title" className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[0_14px_34px_rgba(11,61,53,0.22)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-blue">Outlet cleanup</p>
        <h2 id="cleanup-reminder-title" className="mt-1 text-xl font-bold text-primary-blue">Keep your outlet data up to date{summary.name ? `, ${summary.name.split(" ")[0]}` : ""}</h2>
        <p className="mt-2 text-sm text-muted-strong">
          {summary.outlets === 0
            ? "No active outlets are on your team in the universe yet."
            : `You have reviewed ${summary.reviewed.toLocaleString()} of ${summary.outlets.toLocaleString()} active outlets (${summary.pctReviewed}%). The target for ${month} is ${summary.targetPct}%${onTrack ? ", and you have reached it." : "."}`}
        </p>
        {summary.outlets > 0 ? (
          <div className="mt-4">
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-background-elevated">
              <div className="h-full rounded-full bg-primary-blue" style={{ width: `${Math.min(100, summary.pctReviewed)}%` }} />
              {summary.targetPct < 100 ? <div className="absolute top-0 h-full w-0.5 bg-brand-orange" style={{ left: `${summary.targetPct}%` }} /> : null}
            </div>
            <ul className="mt-3 flex flex-col gap-1 text-sm text-muted-strong">
              <li>{toDo.toLocaleString()} active outlets still to review</li>
              {summary.missingGeo > 0 ? <li>{summary.missingGeo.toLocaleString()} outlets have no GPS point: visit and tag them</li> : null}
              {summary.waitingForMe > 0 ? <li className="font-semibold text-brand-orange">{summary.waitingForMe} marked-open outlet{summary.waitingForMe === 1 ? "" : "s"} waiting for your answer</li> : null}
              {summary.rank ? <li>You are ranked {summary.rank} of {summary.rankedTeams} team leaders</li> : null}
            </ul>
          </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link ref={startRef} href="/outlet-cleanup" onClick={() => setOpen(false)} className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2 text-sm font-semibold text-white hover:shadow-cyan-glow">
            Open the cleanup
          </Link>
          <button type="button" onClick={() => setOpen(false)} className="rounded-full border border-border px-5 py-2 text-sm font-semibold text-primary-blue hover:bg-accent-blue-soft">
            Remind me later
          </button>
        </div>
      </div>
    </div>
  );
}
