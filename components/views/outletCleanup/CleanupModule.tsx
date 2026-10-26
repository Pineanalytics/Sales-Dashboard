"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatNumber } from "@/lib/format";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "@/lib/outletUniverse/normalize";
import { ACTIVITY_LABELS } from "@/lib/outletCleanup/activity";
import type { CleanupOptions, OutletActivity, QueueRow, ReviewState } from "@/lib/outletCleanup/types";
import { OpenOutlets } from "./OpenOutlets";
import { OutletPanel } from "./OutletPanel";
import { ProgressDashboard } from "./ProgressDashboard";
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

const STATE_TIER: Record<ReviewState, "good" | "warn" | "bad" | "neutral"> = { UNREVIEWED: "neutral", REVIEWED: "warn", VALIDATED: "good", APPLIED: "good", REJECTED: "bad", DISOWNED: "neutral" };
const STATE_LABEL: Record<ReviewState, string> = { UNREVIEWED: "Not reviewed", REVIEWED: "Awaiting admin", VALIDATED: "Validated", APPLIED: "Applied", REJECTED: "Sent back", DISOWNED: "Marked open" };

const SECTIONS: { value: Section; label: string }[] = [
  { value: "progress", label: "Progress" },
  { value: "outlets", label: "My outlets" },
  { value: "routes", label: "Routes" },
  { value: "open", label: "Marked open outlets" },
  { value: "review", label: "Review" },
  { value: "targets", label: "Targets" },
];

const pageButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft";
const pageDisabled = "rounded-full border border-border/60 px-3 py-1.5 text-xs font-semibold text-muted/60";

/** The Cleanup tab of Active Outlets: the outlets the signed-in person works on, with the form to verify one. Edits go to the cleanup tables, not the universe. */
export function CleanupModule() {
  const [section, setSection] = useState<Section>("progress");
  const [state, setState] = useState("todo");
  const [activity, setActivity] = useState<"all" | "active" | "dormant">("active");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<QueuePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<{ source: string; outletKey: string } | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ state, page: String(page) });
    if (query) params.set("q", query);
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
  }, [state, activity, page, query, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

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
        {SECTIONS.filter((item) => (item.value !== "targets" && item.value !== "review") || payload?.actor.isAdmin).map((item) => (
          <button key={item.value} role="tab" aria-selected={section === item.value} onClick={() => setSection(item.value)} className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-300 ${section === item.value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"}`}>
            {item.label}
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
      {section === "review" && payload?.actor.isAdmin ? (
        <ReviewPanel
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
            <input aria-label="Search outlets" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search outlet, territory or key" className="ml-auto w-64 rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue" />
          </div>

          {status === "loading" || !payload ? (
            <p className="mt-4 text-sm text-muted">Loading…</p>
          ) : (
            <>
              <div className="mt-4">
                <TableWrap>
                  <Thead>
                    <Th>Outlet</Th>
                    <Th>System</Th>
                    <Th>Principal(s)</Th>
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
                        <Td title={`${row.outletName} (${row.outletKey})`}>{row.outletName}</Td>
                        <Td>{OUTLET_SOURCE_LABELS[row.source as OutletSource] ?? row.source}</Td>
                        <Td title={row.principals}>{row.principals}</Td>
                        <Td>{row.territory}</Td>
                        <Td>{row.region}</Td>
                        <Td>{row.teamLeaders || "—"}</Td>
                        <Td title={row.lastPurchaseDate ? `Last purchase ${row.lastPurchaseDate}` : "No purchase on record"}>
                          <Badge tier={ACTIVITY_TIER[row.activity]}>{row.activity === "ACTIVE" || row.daysSince === null ? ACTIVITY_LABELS[row.activity] : `${ACTIVITY_LABELS[row.activity]} · ${row.daysSince} d`}</Badge>
                        </Td>
                        <Td>{row.shopSize > 1 ? <Badge tier="warn">Duplicate · {row.shopSize} in shop</Badge> : "—"}</Td>
                        <Td>{row.hasGeo ? "✓" : <span className="font-semibold text-brand-orange">Missing</span>}</Td>
                        <Td><Badge tier={STATE_TIER[row.state]}>{STATE_LABEL[row.state]}</Badge></Td>
                        <Td>
                          <button onClick={() => setOpen({ source: row.source, outletKey: row.outletKey })} className={pageButton}>
                            {row.state === "UNREVIEWED" || row.state === "REJECTED" ? "Review" : "Open"}
                          </button>
                        </Td>
                      </tr>
                    ))}
                    {payload.rows.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="px-3 py-8 text-center text-muted">Nothing here. Try another filter.</td>
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
            </>
          )}
        </SectionCard>
      )}
    </div>
  );
}
