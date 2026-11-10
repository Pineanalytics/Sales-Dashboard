"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import { OFF_ROSTER_REP } from "@/lib/outletCleanup/repFilter";
import { ACTIVITY_LABELS } from "@/lib/outletCleanup/activity";
import { REVIEW_STATE_LABELS, type CleanupOptions, type OutletActivity, type QueueFilterOptions, type QueueRow, type ReviewState } from "@/lib/outletCleanup/types";
import { BulkDisown, type BulkDisownResult, type SelectedOutlet } from "./BulkDisown";
import { OpenOutlets } from "./OpenOutlets";
import { OutletPanel } from "./OutletPanel";
import { ProgressDashboard } from "./ProgressDashboard";
import { ReportExtract } from "./ReportExtract";
import { ReviewPanel } from "./ReviewPanel";
import { RoutesPanel } from "./RoutesPanel";
import { TargetsPanel } from "./TargetsPanel";

type Section = "progress" | "outlets" | "routes" | "open" | "review" | "targets";

interface QueuePayload {
  rows: QueueRow[];
  total: number;
  page: number;
  pageCount: number;
  options: CleanupOptions;
  actor: { role: string; isAdmin: boolean; name: string | null };
}

const STATES: { value: string; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "unreviewed", label: "Not yet reviewed" },
  { value: "drafts", label: "My drafts" },
  { value: "needs-geo", label: "Missing GPS" },
  { value: "rejected", label: "Sent back" },
  { value: "reviewed", label: "Reviewed" },
  { value: "disowned", label: "Marked open" },
  { value: "all", label: "All" },
];

const ACTIVITY_TIER: Record<OutletActivity, "good" | "warn" | "bad" | "neutral"> = { ACTIVE: "good", LAPSED: "warn", LOST: "bad", NO_PURCHASE: "neutral" };
const ACTIVITY_FILTERS: { value: "all" | "active" | "dormant"; label: string }[] = [
  { value: "all", label: "Active and dormant" },
  { value: "active", label: "Active only" },
  { value: "dormant", label: "Dormant only" },
];

const STATE_TIER: Record<ReviewState, "good" | "warn" | "bad" | "neutral"> = { UNREVIEWED: "neutral", SUBMITTED: "warn", REVIEWED: "warn", VALIDATED: "good", APPLIED: "good", REJECTED: "bad", DISOWNED: "neutral" };

const SECTIONS: { value: Section; label: string }[] = [
  { value: "progress", label: "Progress" },
  { value: "outlets", label: "My outlets" },
  { value: "routes", label: "Routes" },
  { value: "open", label: "Marked open outlets" },
  { value: "review", label: "Review" },
  { value: "targets", label: "Targets" },
];

const filterSelect = "w-52 rounded-full border border-border bg-background-elevated px-3 py-1.5 text-xs text-muted-strong outline-none focus:border-primary-blue";

const pageButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft";
const pageDisabled = "rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted/60";

/** The Cleanup tab of Active Outlets: the outlets the signed-in person works on, with the form to verify one. Edits go to the cleanup tables, not the universe. */
export function CleanupModule({ initialSection }: { initialSection?: Section }) {
  const [section, setSection] = useState<Section>(initialSection ?? "progress");
  const [state, setState] = useState("todo");
  const [activity, setActivity] = useState<"all" | "active" | "dormant">("active");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [rep, setRep] = useState("");
  const [territory, setTerritory] = useState("");
  const [filterOptions, setFilterOptions] = useState<QueueFilterOptions>({ reps: [], territories: [], offRoster: 0 });
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<{ source: string; outletKey: string } | null>(null);
  const [reporting, setReporting] = useState(false);
  // Outlets ticked for a bulk disown (only while one rep's outlets are on screen), kept across pages; cleared when the rep changes.
  const [selected, setSelected] = useState<Map<string, SelectedOutlet>>(new Map());
  const [selecting, setSelecting] = useState(false);
  const [disownNotice, setDisownNotice] = useState<string | null>(null);
  // For an admin: the marked-open outlets nobody owns, shown as a count on the tab.
  const [toAllocate, setToAllocate] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (rep) params.set("rep", rep);
    if (territory) params.set("territory", territory);
    fetch(`/api/outlet-cleanup/filters?${params.toString()}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: QueueFilterOptions | null) => {
        if (!cancelled && body) setFilterOptions(body);
      })
      .catch(() => {
        // The filters are a convenience; the list still works without them.
      });
    return () => {
      cancelled = true;
    };
  }, [rep, territory, tick]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ state, page: String(page) });
    if (query) params.set("q", query);
    if (rep) params.set("rep", rep);
    if (territory) params.set("territory", territory);
    if (activity !== "all") params.set("activity", activity);
    fetch(`/api/outlet-cleanup/queue?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the cleanup list.");
        if (!cancelled) {
          setPayload(body);
          setStatus("idle");
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setErrorText(error.message);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state, activity, page, query, rep, territory, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const isAdmin = payload?.actor.isAdmin ?? false;
  // Admins validate everything, supervisors the team leaders under them, and team leaders approve what their sales reps submit.
  const reviewer = isAdmin || payload?.actor.role === "SUPERVISOR" || payload?.actor.role === "TEAM_LEADER";

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    fetch("/api/outlet-cleanup/summary", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { adminQueue?: { total: number } } | null) => {
        if (!cancelled) setToAllocate(body?.adminQueue?.total ?? 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isAdmin, tick, section]);
  // The ticks belong to the rep on screen, so a different rep starts a fresh selection.
  const changeRep = (next: string) => {
    setRep(next);
    setSelected(new Map());
    setPage(1);
  };
  const canBulk = rep !== "" && payload !== null && payload.actor.role !== "HOD" && payload.actor.role !== "DIRECTOR";
  const rowKey = (row: { source: string; outletKey: string }) => `${row.source}|${row.outletKey}`;
  const selectable = (payload?.rows ?? []).filter((row) => row.state !== "DISOWNED");
  const pageSelected = selectable.length > 0 && selectable.every((row) => selected.has(rowKey(row)));
  const toggleRow = (row: SelectedOutlet) =>
    setSelected((all) => {
      const next = new Map(all);
      if (next.has(rowKey(row))) next.delete(rowKey(row));
      else next.set(rowKey(row), { source: row.source, outletKey: row.outletKey });
      return next;
    });
  const togglePage = () =>
    setSelected((all) => {
      const next = new Map(all);
      for (const row of selectable) {
        if (pageSelected) next.delete(rowKey(row));
        else next.set(rowKey(row), { source: row.source, outletKey: row.outletKey });
      }
      return next;
    });
  // Every outlet the current filters match, not just the page on screen.
  const selectAllMatching = async () => {
    const params = new URLSearchParams({ state, keys: "1" });
    if (query) params.set("q", query);
    if (rep) params.set("rep", rep);
    if (territory) params.set("territory", territory);
    if (activity !== "all") params.set("activity", activity);
    try {
      const response = await fetch(`/api/outlet-cleanup/queue?${params.toString()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Failed to list the outlets.");
      setSelected(new Map((body.keys as SelectedOutlet[]).map((k) => [rowKey(k), k])));
      setDisownNotice(body.total > body.keys.length ? `Chosen the first ${body.keys.length} of ${body.total} matching outlets, the most one bulk disown takes. Narrow the list (territory, search) to reach the rest.` : null);
    } catch (error) {
      setDisownNotice((error as Error).message);
    }
  };
  const onDisowned = (result: BulkDisownResult) => {
    setSelected(new Map());
    const skipped = result.skipped.length > 0 ? ` ${result.skipped.length} skipped: ${result.skipped.slice(0, 5).map((s) => `${s.outletName} (${s.reason.replace(/\.$/, "").toLowerCase()})`).join("; ")}${result.skipped.length > 5 ? "…" : ""}.` : "";
    setDisownNotice(`${result.count} outlet${result.count === 1 ? "" : "s"} marked open${result.ownerUnknown ? " with the owner unknown; an admin will allocate them" : ""}.${skipped}`);
    refresh();
  };
  // The chosen value stays on its list even when the other filter has narrowed it away, so the control never shows a value it cannot display.
  const withChoice = (list: string[], choice: string) => (choice && !list.includes(choice) ? [choice, ...list] : list);

  if (status === "error") {
    return (
      <SectionCard title="Outlet cleanup">
        <p className="text-sm text-muted-strong">{errorText}</p>
      </SectionCard>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionCard title="Outlet cleanup" action={payload?.actor.name ? <span className="text-xs text-muted">{payload.actor.name}</span> : null}>
        <p className="text-sm text-muted-strong">
          Verify the outlets on your team: their region, territory, channel, customer type and contacts, their GPS location and selling rep, and any duplicates. Your changes are saved here first; an admin then validates them and applies them to the Active Outlet universe.
        </p>
      </SectionCard>

      <div className="inline-flex w-fit flex-wrap gap-1 rounded-full bg-background-elevated p-0.5" role="tablist" aria-label="Cleanup sections">
        {SECTIONS.filter((item) => (item.value === "targets" ? payload?.actor.isAdmin : item.value === "review" ? reviewer : true)).map((item) => (
          <button key={item.value} role="tab" aria-selected={section === item.value} onClick={() => setSection(item.value)} className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-300 ${section === item.value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"}`}>
            {item.label}
            {item.value === "open" && toAllocate > 0 ? <span className="ml-1.5 rounded-full bg-brand-orange px-1.5 py-0.5 text-[10px] font-bold text-white" title={`${toAllocate} outlet${toAllocate === 1 ? "" : "s"} waiting for you to allocate`}>{toAllocate}</span> : null}
          </button>
        ))}
      </div>

      {section === "progress" ? (
        <ProgressDashboard
          onOpenOutlets={(next) => {
            setState(next);
            setPage(1);
            setSection("outlets");
          }}
        />
      ) : null}
      {section === "routes" ? <RoutesPanel /> : null}
      {section === "open" ? <OpenOutlets onChanged={refresh} /> : null}
      {section === "review" && reviewer ? (
        <ReviewPanel
          isAdmin={isAdmin}
          role={payload?.actor.role ?? ""}
          onOpenOutlet={(source, outletKey) => {
            setOpen({ source, outletKey });
            setSection("outlets");
          }}
        />
      ) : null}
      {section === "targets" && payload?.actor.isAdmin ? <TargetsPanel onChanged={refresh} /> : null}

      {section !== "outlets" ? null : open ? (
        <OutletPanel key={`${open.source}|${open.outletKey}`} source={open.source} outletKey={open.outletKey} onClose={() => setOpen(null)} onChanged={refresh} />
      ) : (
        <SectionCard title="Your outlets">
          <div className="flex flex-wrap items-center gap-2">
            {STATES.map((s) => (
              <button
                key={s.value}
                onClick={() => {
                  setState(s.value);
                  setPage(1);
                }}
                aria-pressed={state === s.value}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${state === s.value ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}
              >
                {s.label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border" />
            {ACTIVITY_FILTERS.map((a) => (
              <button
                key={a.value}
                onClick={() => {
                  setActivity(a.value);
                  setPage(1);
                }}
                aria-pressed={activity === a.value}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${activity === a.value ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}
              >
                {a.label}
              </button>
            ))}
            <select aria-label="Filter by rep" value={rep} onChange={(e) => changeRep(e.target.value)} className={filterSelect}>
              <option value="">All reps</option>
              {filterOptions.offRoster > 0 || rep === OFF_ROSTER_REP ? <option value={OFF_ROSTER_REP}>Rep not on my roster ({formatNumber(filterOptions.offRoster)})</option> : null}
              {filterOptions.reps.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select aria-label="Filter by territory" value={territory} onChange={(e) => { setTerritory(e.target.value); setPage(1); }} className={filterSelect}>
              <option value="">All territories</option>
              {withChoice(filterOptions.territories, territory).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            {rep || territory ? (
              <button onClick={() => { changeRep(""); setTerritory(""); }} className={pageButton}>Clear rep / territory</button>
            ) : null}
            <button onClick={() => setReporting(!reporting)} aria-pressed={reporting} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${reporting ? "border-primary-blue bg-primary-blue text-white" : "border-primary-blue text-primary-blue hover:bg-accent-blue-soft"}`}>
              {reporting ? "Hide report extract" : "Report extract"}
            </button>
            <input aria-label="Search outlets" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search outlet or key" className="w-56 rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue" />
          </div>

          {reporting ? <ReportExtract initialRep={rep} initialTerritory={territory} /> : null}

          {canBulk ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
              <button onClick={() => setSelecting(!selecting)} aria-pressed={selecting} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${selecting ? "border-primary-blue bg-primary-blue text-white" : "border-primary-blue text-primary-blue hover:bg-accent-blue-soft"}`}>
                {selecting ? "Stop choosing outlets" : "Choose outlets to disown"}
              </button>
              {selecting ? <span>Tick the outlets that are not yours{rep === OFF_ROSTER_REP ? "" : ` among ${rep}'s`}, then disown them together.</span> : null}
              {selecting && payload && payload.total > selectable.length ? <button onClick={selectAllMatching} className={pageButton}>Choose all {formatNumber(payload.total)} matching</button> : null}
            </div>
          ) : null}
          {disownNotice ? (
            <p role="status" className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm text-muted-strong">
              <span>{disownNotice}</span>
              <button onClick={() => setDisownNotice(null)} className="text-xs font-semibold text-primary-blue hover:underline">Dismiss</button>
            </p>
          ) : null}

          {status === "loading" || !payload ? (
            <p className="mt-4 text-sm text-muted">Loading…</p>
          ) : (
            <>
              <div className="mt-4">
                <TableWrap>
                  <Thead>
                    {canBulk && selecting ? <Th><input type="checkbox" aria-label="Choose every outlet on this page" checked={pageSelected} disabled={selectable.length === 0} onChange={togglePage} /></Th> : null}
                    <Th>Outlet</Th>
                    <Th>System</Th>
                    <Th>Principal(s)</Th>
                    <Th>Rep</Th>
                    <Th>Territory</Th>
                    <Th>Region</Th>
                    <Th>Team leader</Th>
                    <Th>Buying</Th>
                    <Th>Shop</Th>
                    <Th>GPS</Th>
                    <Th>Status</Th>
                    <Th>{""}</Th>
                  </Thead>
                  <tbody>
                    {payload.rows.map((row) => (
                      <tr key={`${row.source}|${row.outletKey}`}>
                        {canBulk && selecting ? (
                          <Td>
                            <input type="checkbox" aria-label={`Choose ${row.outletName}`} checked={selected.has(rowKey(row))} disabled={row.state === "DISOWNED"} onChange={() => toggleRow(row)} title={row.state === "DISOWNED" ? "Already marked open" : undefined} />
                          </Td>
                        ) : null}
                        <Td title={`${row.outletName} (${row.outletKey})`}>{row.outletName}</Td>
                        <Td>{OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source}</Td>
                        <Td title={row.principals}>{row.principals}</Td>
                        <Td title={row.reps}>{row.reps || "—"}</Td>
                        <Td>{row.territory}</Td>
                        <Td>{row.region}</Td>
                        <Td>{row.teamLeaders || "—"}</Td>
                        <Td title={row.lastPurchaseDate ? `Last purchase ${row.lastPurchaseDate}` : "No purchase on record"}>
                          <Badge tier={ACTIVITY_TIER[row.activity]}>{row.activity === "ACTIVE" || row.daysSince === null ? ACTIVITY_LABELS[row.activity] : `${ACTIVITY_LABELS[row.activity]} · ${row.daysSince} d`}</Badge>
                        </Td>
                        <Td>{row.shopSize > 1 ? <Badge tier="warn">Duplicate · {row.shopSize} in shop</Badge> : "—"}</Td>
                        <Td>{row.hasGeo ? "✓" : <span className="font-semibold text-brand-orange">Missing</span>}</Td>
                        <Td><Badge tier={STATE_TIER[row.state]}>{REVIEW_STATE_LABELS[row.state]}</Badge>{row.hasDraft ? <span className="ml-1.5 align-middle"><Badge tier="warn">Draft saved</Badge></span> : null}</Td>
                        <Td>
                          <button onClick={() => setOpen({ source: row.source, outletKey: row.outletKey })} className={pageButton}>
                            {row.state === "UNREVIEWED" || row.state === "REJECTED" ? "Review" : "Open"}
                          </button>
                        </Td>
                      </tr>
                    ))}
                    {payload.rows.length === 0 ? (
                      <tr>
                        <td colSpan={canBulk && selecting ? 13 : 12} className="px-3 py-8 text-center text-muted">Nothing here. Try another filter.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </TableWrap>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                <span>{formatNumber(payload.total)} outlet{payload.total === 1 ? "" : "s"} · page {payload.page} of {payload.pageCount}</span>
                <div className="flex items-center gap-2">
                  {payload.page > 1 ? <button onClick={() => setPage(payload.page - 1)} className={pageButton}>← Previous</button> : <span className={pageDisabled}>← Previous</span>}
                  {payload.page < payload.pageCount ? <button onClick={() => setPage(payload.page + 1)} className={pageButton}>Next →</button> : <span className={pageDisabled}>Next →</span>}
                </div>
              </div>
              {canBulk && selecting && selected.size > 0 ? <BulkDisown selected={[...selected.values()]} repName={rep === OFF_ROSTER_REP ? "" : rep} onClear={() => setSelected(new Map())} onDone={onDisowned} /> : null}
            </>
          )}
        </SectionCard>
      )}
    </div>
  );
}
