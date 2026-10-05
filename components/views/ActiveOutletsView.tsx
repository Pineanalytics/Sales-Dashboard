"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Legend, Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionCard } from "@/components/ui/KpiGrid";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";
import { BuildingShop20Regular } from "@fluentui/react-icons";
import type { OutletFilterOptions, OutletFilters, OutletListRow, OutletUniverseSummary } from "@/lib/outletUniverse/query";
import { Dashboard } from "./activeOutlets/Dashboard";
import { FilterBar } from "./activeOutlets/FilterBar";
import { OutletList } from "./activeOutlets/OutletList";

interface UniversePayload {
  summary: OutletUniverseSummary;
  list: { rows: OutletListRow[]; total: number; page: number; pageCount: number };
  canRefresh: boolean;
}

const DEFAULT_FILTERS: OutletFilters = {
  view: "principal",
  status: "active",
  source: null,
  principal: null,
  channel: null,
  segment: null,
  region: null,
  territory: null,
  route: null,
  rep: null,
  q: "",
};

function toParams(filters: OutletFilters, page?: number): URLSearchParams {
  const params = new URLSearchParams({ view: filters.view, status: filters.status });
  for (const key of ["source", "principal", "channel", "segment", "region", "territory", "route", "rep", "q"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (page && page > 1) params.set("page", String(page));
  return params;
}

function minutesAgo(iso: string | null): string {
  if (!iso) return "not compiled yet";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
}

interface PineMonthly {
  month: string;
  monthIndex: number;
  salesRole: string;
  distinctOutlets: number;
}

/** The monthly distinct-buying-outlet trend, which exists for Pine only (the
 *  Leverage and EABL feeds have no monthly outlet ledger yet). Loaded on demand. */
function PineMonthlyTrend() {
  const [rows, setRows] = useState<PineMonthly[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/active-outlets?role=all", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error();
      setRows(body.monthly as PineMonthly[]);
    } catch {
      setFailed(true);
    }
  }, []);

  const months = Array.from(new Set((rows ?? []).map((row) => row.monthIndex))).sort((a, b) => a - b);
  const data = months.map((monthIndex) => {
    const inMonth = (rows ?? []).filter((row) => row.monthIndex === monthIndex);
    return {
      name: (inMonth[0]?.month ?? "").slice(0, 3),
      Primary: inMonth.filter((row) => row.salesRole === "Primary Sales").reduce((sum, row) => sum + row.distinctOutlets, 0),
      Secondary: inMonth.filter((row) => row.salesRole === "Secondary Sales").reduce((sum, row) => sum + row.distinctOutlets, 0),
    };
  });

  return (
    <details onToggle={(event) => (event.currentTarget.open && rows === null && !failed ? void load() : undefined)} className="rounded-xl bg-surface p-4 shadow-[0_1px_3px_rgba(11,61,53,0.06)]">
      <summary className="cursor-pointer text-sm font-semibold text-primary-blue">Pine monthly trend – distinct buying outlets (Primary vs Secondary)</summary>
      <div className="mt-4">
        {failed ? <p className="text-sm text-muted">The monthly trend could not be loaded.</p> : null}
        {rows === null && !failed ? <p className="text-sm text-muted">Loading…</p> : null}
        {rows !== null ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="Primary" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Secondary" stroke={CHART_COLORS[1]} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </details>
  );
}

export function ActiveOutletsView() {
  const [filters, setFilters] = useState<OutletFilters>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"dashboard" | "list">("dashboard");
  const [payload, setPayload] = useState<UniversePayload | null>(null);
  const [options, setOptions] = useState<OutletFilterOptions | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [reloadTick, setReloadTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const queryString = useMemo(() => toParams(filters, page).toString(), [filters, page]);
  const exportHref = useMemo(() => `/api/outlet-universe/export?${toParams(filters).toString()}`, [filters]);

  // Debounce the free-text search so each keystroke is not a query.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters((current) => (current.q === searchText.trim() ? current : { ...current, q: searchText.trim() }));
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/outlet-universe?${queryString}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load Active Outlet data.");
        if (!cancelled) {
          setPayload(body);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryString, reloadTick]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/outlet-universe/options", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body) setOptions(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  // The first visit after a deploy finds an empty universe that is compiling in the background.
  const compiling = payload !== null && payload.summary.builtAt === null;
  useEffect(() => {
    if (!compiling) return;
    const timer = window.setTimeout(() => setReloadTick((tick) => tick + 1), 6000);
    return () => window.clearTimeout(timer);
  }, [compiling, reloadTick]);

  const patchFilters = (patch: Partial<OutletFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  };
  const resetFilters = () => {
    setFilters((current) => ({ ...DEFAULT_FILTERS, view: current.view }));
    setSearchText("");
    setPage(1);
  };
  const refreshNow = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/outlet-universe/rebuild", { method: "POST" });
    } finally {
      setRefreshing(false);
      setReloadTick((tick) => tick + 1);
    }
  };

  if (status === "loading") return <FullPageSpinner label="Loading Active Outlets…" />;
  if (status === "error" || !payload) {
    return <EmptyState icon={<BuildingShop20Regular className="h-10 w-10" />} title="Couldn't load Active Outlets" description="Try refreshing the page. If this keeps happening, the outlet universe may still be compiling." />;
  }
  if (compiling) {
    return <EmptyState icon={<BuildingShop20Regular className="h-10 w-10" />} title="Compiling the Active Outlet universe" description="Pine, Leverage and EABL DMS outlets are being merged for the first time. This page refreshes itself in a few seconds." />;
  }

  const { summary, list } = payload;
  const tabButton = (value: "dashboard" | "list", label: string) => (
    <button
      key={value}
      onClick={() => setTab(value)}
      aria-pressed={tab === value}
      className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-300 ${tab === value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Active Outlet"
        action={
          <div className="flex items-center gap-3 text-xs text-muted">
            <span>Compiled {minutesAgo(summary.builtAt)}</span>
            {payload.canRefresh ? (
              <button onClick={refreshNow} disabled={refreshing} className="rounded-full border border-border px-3 py-1.5 font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50">
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
            ) : null}
          </div>
        }
      >
        <FilterBar filters={filters} options={options} onChange={patchFilters} onReset={resetFilters} searchText={searchText} onSearchText={setSearchText} />
      </SectionCard>

      <div className="inline-flex w-fit gap-1 rounded-full bg-background-elevated p-0.5">
        {tabButton("dashboard", "Dashboard")}
        {tabButton("list", "Outlet listing")}
      </div>

      {tab === "dashboard" ? (
        <>
          <Dashboard summary={summary} filters={filters} onFilter={patchFilters} />
          {filters.source === null || filters.source === "PINE" ? <PineMonthlyTrend /> : null}
        </>
      ) : (
        <OutletList list={list} exportHref={exportHref} onPage={setPage} />
      )}

      <p className="text-xs leading-relaxed text-muted">
        <strong>How to read this.</strong> An outlet is <em>Active</em> when it bought in the last {summary.activeWindowDays} days (Pine&apos;s rule, applied to all three systems: Pine purchase events, Leverage invoices, EABL productive calls).
        Pine, Leverage and EABL DMS have no shared outlet ID, so one shop served by two systems appears once per system; within Pine, an outlet buying several principals is counted once in the General view.
        Leverage history starts mid-2026 and Pine carries no route, so Route is blank for Pine outlets.
      </p>
    </div>
  );
}
