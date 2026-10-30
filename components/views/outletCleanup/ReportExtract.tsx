"use client";

import { useEffect, useState } from "react";
import { formatNumber } from "@/lib/format";
import { OFF_ROSTER_REP } from "@/lib/outletCleanup/repFilter";
import type { QueueFilterOptions, ReportOptions } from "@/lib/outletCleanup/types";

const select = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-xs text-muted-strong outline-none focus:border-primary-blue";
const download = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow";

const STATUSES = [
  { value: "all", label: "Every status" },
  { value: "todo", label: "To do" },
  { value: "unreviewed", label: "Not yet reviewed" },
  { value: "drafts", label: "My drafts" },
  { value: "needs-geo", label: "Missing GPS" },
  { value: "rejected", label: "Sent back" },
  { value: "reviewed", label: "Reviewed" },
  { value: "disowned", label: "Marked open" },
  { value: "duplicates", label: "Duplicates" },
];
const BUYING = [
  { value: "all", label: "Active and dormant" },
  { value: "active", label: "Active only" },
  { value: "dormant", label: "Dormant only" },
];

/** The report extract of the cleanup: the outlets the person works on, narrowed by status, buying, rep, territory, region, principal and team leader, as Excel or CSV. It starts from the rep and territory chosen on the list. */
export function ReportExtract({ initialRep, initialTerritory }: { initialRep: string; initialTerritory: string }) {
  const [status, setStatus] = useState("all");
  const [buying, setBuying] = useState("all");
  const [rep, setRep] = useState(initialRep);
  const [territory, setTerritory] = useState(initialTerritory);
  const [region, setRegion] = useState("");
  const [principal, setPrincipal] = useState("");
  const [teamLeader, setTeamLeader] = useState("");
  const [search, setSearch] = useState("");
  const [reportOptions, setReportOptions] = useState<ReportOptions>({ principals: [], regions: [], teamLeaders: [] });
  const [repOptions, setRepOptions] = useState<QueueFilterOptions>({ reps: [], territories: [], offRoster: 0 });
  // The count is kept with the filters it was made for, so a stale one is never shown against new filters.
  const [counted, setCounted] = useState<{ query: string; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/outlet-cleanup/report?format=options", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: ReportOptions | null) => {
        if (!cancelled && body) setReportOptions(body);
      })
      .catch(() => {
        // The lists are a convenience; the extract works without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The rep and territory lists narrow each other, as on the list.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (rep) params.set("rep", rep);
    if (territory) params.set("territory", territory);
    fetch(`/api/outlet-cleanup/filters?${params.toString()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: QueueFilterOptions | null) => {
        if (!cancelled && body) setRepOptions(body);
      })
      .catch(() => {
        // As above.
      });
    return () => {
      cancelled = true;
    };
  }, [rep, territory]);

  const query = new URLSearchParams({ state: status, activity: buying });
  if (rep) query.set("rep", rep);
  if (territory) query.set("territory", territory);
  if (region) query.set("region", region);
  if (principal) query.set("principal", principal);
  if (teamLeader) query.set("teamLeader", teamLeader);
  if (search.trim()) query.set("q", search.trim());
  const queryText = query.toString();

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch(`/api/outlet-cleanup/report?format=count&${queryText}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { total: number } | null) => {
          if (!cancelled && body) setCounted({ query: queryText, total: body.total });
        })
        .catch(() => {
          // No count shown; the download still works.
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queryText]);

  const count = counted && counted.query === queryText ? counted.total : null;
  const withChoice = (list: string[], choice: string) => (choice && !list.includes(choice) ? [choice, ...list] : list);
  const field = (label: string, control: React.ReactNode) => (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</span>
      {control}
    </label>
  );
  const anyFilter = rep || territory || region || principal || teamLeader || search.trim() || status !== "all" || buying !== "all";

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <h4 className="text-sm font-bold text-primary-blue">Report extract</h4>
      <p className="mt-1 text-xs text-muted">One row per outlet you work on, with its details, GPS, selling reps, buying status and cleanup status. Narrow it with any of the filters, then download it as Excel or CSV.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {field("Cleanup status", <select className={select} value={status} onChange={(e) => setStatus(e.target.value)}>{STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>)}
        {field("Buying", <select className={select} value={buying} onChange={(e) => setBuying(e.target.value)}>{BUYING.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>)}
        {field("Rep", (
          <select className={select} value={rep} onChange={(e) => setRep(e.target.value)}>
            <option value="">All reps</option>
            {repOptions.offRoster > 0 || rep === OFF_ROSTER_REP ? <option value={OFF_ROSTER_REP}>Rep not on my roster ({formatNumber(repOptions.offRoster)})</option> : null}
            {withChoice(repOptions.reps, rep === OFF_ROSTER_REP ? "" : rep).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ))}
        {field("Territory", <select className={select} value={territory} onChange={(e) => setTerritory(e.target.value)}><option value="">All territories</option>{withChoice(repOptions.territories, territory).map((name) => <option key={name} value={name}>{name}</option>)}</select>)}
        {field("Principal", <select className={select} value={principal} onChange={(e) => setPrincipal(e.target.value)}><option value="">All principals</option>{withChoice(reportOptions.principals, principal).map((name) => <option key={name} value={name}>{name}</option>)}</select>)}
        {field("Region", <select className={select} value={region} onChange={(e) => setRegion(e.target.value)}><option value="">All regions</option>{withChoice(reportOptions.regions, region).map((name) => <option key={name} value={name}>{name}</option>)}</select>)}
        {reportOptions.teamLeaders.length > 1 ? field("Team leader", <select className={select} value={teamLeader} onChange={(e) => setTeamLeader(e.target.value)}><option value="">All team leaders</option>{withChoice(reportOptions.teamLeaders, teamLeader).map((name) => <option key={name} value={name}>{name}</option>)}</select>) : null}
        {field("Outlet name or key", <input className={select} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Optional" />)}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a href={`/api/outlet-cleanup/report?format=xlsx&${queryText}`} className={download} download>Download Excel</a>
        <a href={`/api/outlet-cleanup/report?format=csv&${queryText}`} className={download} download>Download CSV</a>
        <span className="text-xs text-muted">{count === null ? "Counting…" : `${formatNumber(count)} outlet${count === 1 ? "" : "s"} in this report`}</span>
        {anyFilter ? (
          <button
            type="button"
            className="text-xs font-semibold text-primary-blue hover:underline"
            onClick={() => {
              setStatus("all");
              setBuying("all");
              setRep("");
              setTerritory("");
              setRegion("");
              setPrincipal("");
              setTeamLeader("");
              setSearch("");
            }}
          >
            Reset filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
