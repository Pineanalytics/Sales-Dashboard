"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import type { TrackerReport } from "@/lib/outletCleanup/trackerShape";

const input = "rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs text-muted-strong outline-none focus:border-primary-blue";
const ROLE_LABEL: Record<string, string> = { REP: "Sales rep", TEAM_LEADER: "Team leader", SUPERVISOR: "Supervisor", ADMIN: "Admin", HOD: "HOD", DIRECTOR: "Director" };

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-navy">{formatNumber(value)}</p>
    </div>
  );
}

/** The cleanup tracker: outlets worked per day, who did the work, and where each team's saved outlets stand. */
export function TrackerPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<TrackerReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"days" | "people" | "teams">("days");

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    setError(null);
    fetch(`/api/outlet-cleanup/tracker?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the tracker.");
        if (!cancelled) setData(body);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  if (error) return <SectionCard title="Tracker"><p className="text-sm text-muted-strong">{error}</p></SectionCard>;
  if (!data) return <SectionCard title="Tracker"><p className="text-sm text-muted">Loading…</p></SectionCard>;
  const busiest = Math.max(1, ...data.days.map((d) => d.outlets));

  return (
    <SectionCard title="Tracker">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">From<input type="date" className={input} value={from || data.from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">To<input type="date" className={input} value={to || data.to} onChange={(e) => setTo(e.target.value)} /></label>
        <p className="text-xs text-muted">Work saved between these dates, from the cleanup log. Team status is where the saved outlets stand today.</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Outlets worked" value={data.totals.outlets} />
        <Tile label="By sales reps" value={data.totals.repOutlets} />
        <Tile label="GPS tagged" value={data.totals.geoTags} />
        <Tile label="Validated" value={data.totals.validated} />
        <Tile label="Sent back" value={data.totals.sentBack} />
        <Tile label="People working" value={data.totals.people} />
      </div>
      <div className="mt-4 inline-flex flex-wrap gap-1 rounded-full bg-background-elevated p-0.5" role="tablist">
        {(["days", "people", "teams"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${view === v ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white" : "text-muted-strong hover:text-primary-blue"}`}>
            {v === "days" ? "By day" : v === "people" ? "By person" : "Team status"}
          </button>
        ))}
      </div>
      <div className="mt-3">
        {view === "days" ? (
          data.days.length === 0 ? <p className="text-sm text-muted">No cleanup work saved in these dates.</p> : (
            <TableWrap>
              <Thead><tr><Th>Day</Th><Th>Outlets worked</Th><Th>By sales reps</Th><Th>GPS tagged</Th><Th>Validated</Th><Th>Sent back</Th></tr></Thead>
              <tbody>
                {[...data.days].reverse().map((d) => (
                  <tr key={d.date}>
                    <Td>{d.date}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-background-elevated"><div className="h-full rounded-full bg-primary-blue" style={{ width: `${(d.outlets / busiest) * 100}%` }} /></div>
                        {formatNumber(d.outlets)}
                      </div>
                    </Td>
                    <Td>{formatNumber(d.repOutlets)}</Td><Td>{formatNumber(d.geoTags)}</Td><Td>{formatNumber(d.validated)}</Td><Td>{formatNumber(d.sentBack)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )
        ) : null}
        {view === "people" ? (
          data.people.length === 0 ? <p className="text-sm text-muted">Nobody saved cleanup work in these dates.</p> : (
            <TableWrap>
              <Thead><tr><Th>Person</Th><Th>Role</Th><Th>Outlets</Th><Th>Actions</Th><Th>GPS tagged</Th><Th>Days active</Th><Th>Last saved</Th></tr></Thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.actor}><Td>{p.actor}</Td><Td>{ROLE_LABEL[p.role] ?? p.role}</Td><Td>{formatNumber(p.outlets)}</Td><Td>{formatNumber(p.actions)}</Td><Td>{formatNumber(p.geoTags)}</Td><Td>{p.days}</Td><Td>{p.lastAt.slice(0, 16).replace("T", " ")}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          )
        ) : null}
        {view === "teams" ? (
          data.teams.length === 0 ? <p className="text-sm text-muted">No outlets saved yet.</p> : (
            <TableWrap>
              <Thead><tr><Th>Team leader</Th><Th>Rep work to approve</Th><Th>Awaiting validation</Th><Th>Validated</Th><Th>Applied</Th><Th>Sent back</Th><Th>GPS tagged</Th></tr></Thead>
              <tbody>
                {data.teams.map((t) => (
                  <tr key={t.teamLeader}><Td>{t.teamLeader}</Td><Td>{formatNumber(t.submitted)}</Td><Td>{formatNumber(t.reviewed)}</Td><Td>{formatNumber(t.validated)}</Td><Td>{formatNumber(t.applied)}</Td><Td>{formatNumber(t.sentBack)}</Td><Td>{formatNumber(t.geoTagged)}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          )
        ) : null}
      </div>
    </SectionCard>
  );
}
