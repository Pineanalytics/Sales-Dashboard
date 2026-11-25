"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownload20Regular, Dismiss16Regular, Search16Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useDashboardStore } from "@/lib/store";
import { normalizePrincipalKey } from "@/lib/normalize";
import { CANONICAL_MONTHS, resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";
import { periodLabelFor, triggerDownload } from "@/lib/reports/download";
import type { CreditNotesResponse } from "@/lib/creditNotes/types";
import { Panel } from "@/components/performanceAnalysis/shared";
import { DistributorReturnsSection } from "./DistributorReturnsSection";
import { EntitySections } from "./EntitySections";
import { OverviewSection } from "./OverviewSection";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "principals", label: "Principals" },
  { id: "items", label: "Items" },
  { id: "customers", label: "Customers" },
  { id: "reps", label: "Sales reps" },
  { id: "branches", label: "Branches" },
  { id: "lines", label: "Largest credit lines" },
  { id: "distributors", label: "Distributor returns" },
] as const;

export type CreditNotesTab = (typeof TABS)[number]["id"];

/** Until the viewer touches the period filter the page shows the whole year to the latest month, the same
 *  convention Performance Analysis and the Overview use (the filter's own default is just the current month). */
function effectivePeriod(selected: PeriodSelection, userChose: boolean): PeriodSelection {
  if (userChose) return selected;
  return { kind: "YTD", year: selected.year, month: selected.month ?? CANONICAL_MONTHS[new Date().getUTCMonth()] };
}

const monthKey = (year: string, monthIndex: number) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

interface LoadState {
  key: string;
  response?: CreditNotesResponse;
  error?: string;
}

/** The Credit Notes & Returns module. It reads the dashboard's own period and principal filter (the filter bar above), so a
 *  figure here is cut exactly as it is on Sales Performance; the search box narrows further to one customer, item, rep or branch. */
export function CreditNotesView() {
  const selectedPeriod = useDashboardStore((s) => s.selectedPeriod);
  const hasUserSelectedPeriod = useDashboardStore((s) => s.hasUserSelectedPeriod);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const [tab, setTab] = useState<CreditNotesTab>("overview");
  const [state, setState] = useState<LoadState>({ key: "" });
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const period = effectivePeriod(selectedPeriod, hasUserSelectedPeriod);
  const months = useMemo(() => (period.year ? resolvePeriodMonths(period).map((m) => monthKey(m.year, m.monthIndex)) : []), [period]);
  const query = useMemo(() => {
    if (months.length === 0) return "";
    const params = new URLSearchParams({ months: months.join(",") });
    const principals = Array.from(new Set(selectedPrincipalKeys.map((key) => normalizePrincipalKey(key)).filter(Boolean)));
    if (principals.length > 0) params.set("principals", principals.join(","));
    if (search) params.set("q", search);
    return params.toString();
  }, [months, selectedPrincipalKeys, search]);
  const periodLabel = periodLabelFor(period);
  const principalLabel = selectedPrincipalKeys.length > 0 ? selectedPrincipalKeys.join(", ") : "All principals";

  // The distributor (DMS) tab runs on its own source; the SAP report does not need to load while it is open.
  const needsReport = tab !== "distributors";
  useEffect(() => {
    if (!query || !needsReport) return;
    const controller = new AbortController();
    fetch(`/api/credit-notes?${query}`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
        return (await res.json()) as CreditNotesResponse;
      })
      .then((response) => setState({ key: query, response }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((previous) => ({ key: query, response: previous.response, error: error instanceof Error ? error.message : "The report could not be loaded." }));
      });
    return () => controller.abort();
  }, [query, needsReport]);

  const loading = needsReport && query !== "" && state.key !== query;
  const report = state.response?.report ?? null;
  const meta = state.response?.meta ?? null;
  const hasData = report !== null && (report.kpi.creditLines > 0 || report.kpi.invoiced > 0);

  async function download() {
    setExportPending(true);
    setExportError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("label", periodLabel);
      params.set("principalLabel", principalLabel);
      const response = await fetch(`/api/credit-notes/export?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to build the export.");
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "credit-notes-returns.xlsx";
      triggerDownload(await response.blob(), filename);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to build the export.");
    } finally {
      setExportPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-foreground">Credit notes &amp; returns</h1>
          <p className="mt-1 text-sm text-muted-strong">
            What was credited back to customers, by principal, item, customer and sales rep. Follows the period and principals chosen in the filter bar above.
          </p>
        </div>
        {needsReport ? (
          <div className="no-print flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              className="px-3 py-1.5"
              icon={exportPending ? <Spinner className="h-3 w-3" /> : <ArrowDownload20Regular className="h-3.5 w-3.5" />}
              disabled={exportPending || !hasData || loading || (report?.kpi.creditLines ?? 0) === 0}
              onClick={download}
              title="Download every list (Excel) for the current period, principals and search"
            >
              {exportPending ? "Building…" : "Export (Excel)"}
            </Button>
            {exportError ? <span className="max-w-[260px] text-right text-[11px] text-accent-red">{exportError}</span> : null}
          </div>
        ) : null}
      </header>

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-full bg-background-elevated p-1" role="tablist" aria-label="Credit notes and returns sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === item.id ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-sm" : "text-muted-strong hover:text-primary-blue"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {needsReport ? (
          <label className="relative flex min-w-[240px] items-center">
            <Search16Regular className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Filter to a customer, item, rep or branch…"
              aria-label="Filter credit notes by customer, item, sales rep or branch"
              maxLength={80}
              className="w-full rounded-full border border-border bg-surface py-1.5 pl-9 pr-8 text-xs text-foreground outline-none focus:border-secondary-blue"
            />
            {searchInput ? (
              <button type="button" onClick={() => setSearchInput("")} aria-label="Clear the search" className="absolute right-2 rounded-full p-0.5 text-muted hover:text-foreground">
                <Dismiss16Regular className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
        ) : null}
      </div>
      {needsReport && !hasUserSelectedPeriod ? <p className="-mt-2 text-xs text-muted">Showing the year to date. Choose a period above to narrow it.</p> : null}
      {needsReport && state.response?.scoped ? <p className="-mt-2 text-xs text-muted">Your account is limited to its own team or principals, so these figures cover only those.</p> : null}

      {tab === "distributors" ? <DistributorReturnsSection months={months} /> : null}

      {needsReport && state.error ? (
        <Panel>
          <p className="py-6 text-center text-sm text-red-600">{state.error}</p>
        </Panel>
      ) : null}

      {needsReport && !state.response && !state.error ? (
        <Panel>
          <p className="py-10 text-center text-sm text-muted">Loading the report…</p>
        </Panel>
      ) : null}

      {needsReport && state.response && !hasData && !loading ? (
        <Panel>
          <p className="py-10 text-center text-sm text-muted">
            {meta ? "No SAP invoices or credit notes match this period, principal selection and search." : "The SAP document lines have not been built yet. They refresh once a day from SAP."}
          </p>
        </Panel>
      ) : null}

      {needsReport && report && hasData ? (
        <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-50" : ""}`} aria-busy={loading}>
          {tab === "overview" ? <OverviewSection report={report} onOpen={setTab} /> : <EntitySections tab={tab} report={report} onFilter={(text) => setSearchInput(text)} />}

          <footer className="border-t border-border pt-4 text-[13px] text-muted">
            Source: SAP Business One invoices and credit notes (excl. VAT), {report.kpi.creditLines.toLocaleString("en-US")} credit-note lines in this selection. Credit notes are shown as positive amounts and
            the rate is credit notes as a share of what was invoiced over the same period and slice. Credit notes cover returns, damages and price corrections; SAP does not separate them on the line.
            {report.priorScope.length > 0 ? " Change compares with the equal-length period just before." : " The earlier period is not in the stored SAP lines, so no comparison is shown."}
            {meta ? ` SAP read as of ${meta.asOf}.` : ""}
          </footer>
        </div>
      ) : null}
    </div>
  );
}
