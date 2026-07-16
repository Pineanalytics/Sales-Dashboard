"use client";

import { useMemo, useState } from "react";
import {
  CANONICAL_MONTHS,
  getAvailableYears,
  getAvailableMonths,
  resolvePeriodMonths,
  type PeriodSelection,
} from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";

interface ReportFiltersProps {
  dataset: Dataset;
  period: PeriodSelection;
  principalKey: string | null;
  repFilter: string | null;
  onPeriodChange: (period: PeriodSelection) => void;
  onPrincipalChange: (principalKey: string | null) => void;
  onRepChange: (repFilter: string | null) => void;
}

interface Bounds {
  fromYear: string;
  fromMonth: string;
  toYear: string;
  toMonth: string;
}

function boundsOfPeriod(period: PeriodSelection): Bounds {
  const months = resolvePeriodMonths(period);
  if (months.length === 0) {
    return { fromYear: period.year, fromMonth: period.month ?? CANONICAL_MONTHS[0], toYear: period.year, toMonth: period.month ?? CANONICAL_MONTHS[0] };
  }
  const sorted = [...months].sort((a, b) => (a.year === b.year ? a.monthIndex - b.monthIndex : Number(a.year) - Number(b.year)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return { fromYear: first.year, fromMonth: CANONICAL_MONTHS[first.monthIndex], toYear: last.year, toMonth: CANONICAL_MONTHS[last.monthIndex] };
}

function quarterOfMonth(monthIndex: number): "Q1" | "Q2" | "Q3" | "Q4" {
  return (["Q1", "Q2", "Q3", "Q4"] as const)[Math.floor(monthIndex / 3)];
}

function halfOfMonth(monthIndex: number): "H1" | "H2" {
  return monthIndex < 6 ? "H1" : "H2";
}

/** Per-report customization panel for the Reports Module — lets a user pick a date
 *  range, principal, and rep independent of the live dashboard's own filter bar.
 *  Local-only: nothing here ever writes back to the Zustand store. */
export function ReportFilters({ dataset, period, principalKey, repFilter, onPeriodChange, onPrincipalChange, onRepChange }: ReportFiltersProps) {
  const [repInput, setRepInput] = useState(repFilter ?? "");

  const years = getAvailableYears(dataset);
  const bounds = boundsOfPeriod(period);
  const fromMonths = getAvailableMonths(dataset, bounds.fromYear);
  const toMonths = getAvailableMonths(dataset, bounds.toYear);

  const principals = useMemo(() => {
    const names = new Set(dataset.monthlySales.map((r) => r.principal));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [dataset]);

  const repSuggestions = useMemo(() => {
    const names = new Set<string>();
    for (const r of dataset.monthlyCoverage) names.add(r.employeeName);
    for (const r of dataset.monthlyBrandCustomer) names.add(r.salesEmployee);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [dataset]);

  function setRange(next: Partial<Bounds>) {
    const merged = { ...bounds, ...next };
    onPeriodChange({ kind: "CUSTOM", year: merged.fromYear, month: merged.fromMonth, toYear: merged.toYear, toMonth: merged.toMonth });
  }

  function quickPick(kind: "MONTH" | "QUARTER" | "YTD" | "HALF") {
    const years2 = getAvailableYears(dataset);
    const year = bounds.toYear || years2[years2.length - 1] || "";
    const monthIdx = CANONICAL_MONTHS.indexOf(bounds.toMonth) >= 0 ? CANONICAL_MONTHS.indexOf(bounds.toMonth) : 0;
    if (kind === "MONTH") onPeriodChange({ kind: "MONTH", year, month: bounds.toMonth });
    else if (kind === "QUARTER") onPeriodChange({ kind: quarterOfMonth(monthIdx), year });
    else if (kind === "YTD") onPeriodChange({ kind: "YTD", year, month: bounds.toMonth });
    else onPeriodChange({ kind: halfOfMonth(monthIdx), year });
  }

  function commitRep() {
    const trimmed = repInput.trim();
    onRepChange(trimmed || null);
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-background-elevated/60 p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">From</label>
          <div className="flex gap-1.5">
            <select
              aria-label="From year"
              value={bounds.fromYear}
              onChange={(e) => setRange({ fromYear: e.target.value })}
              className="rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-strong"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              aria-label="From month"
              value={bounds.fromMonth}
              onChange={(e) => setRange({ fromMonth: e.target.value })}
              className="rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-strong"
            >
              {fromMonths.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">To</label>
          <div className="flex gap-1.5">
            <select
              aria-label="To year"
              value={bounds.toYear}
              onChange={(e) => setRange({ toYear: e.target.value })}
              className="rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-strong"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              aria-label="To month"
              value={bounds.toMonth}
              onChange={(e) => setRange({ toMonth: e.target.value })}
              className="rounded-full border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-muted-strong"
            >
              {toMonths.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {(["MONTH", "QUARTER", "YTD", "HALF"] as const).map((k) => (
            <button
              key={k}
              onClick={() => quickPick(k)}
              className="rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold text-muted-strong transition-colors hover:border-primary-blue hover:text-primary-blue"
            >
              {k === "MONTH" ? "This Month" : k === "QUARTER" ? "This Quarter" : k === "YTD" ? "YTD" : "This Half"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">Principal</label>
          <select
            aria-label="Principal"
            value={principalKey ?? ""}
            onChange={(e) => onPrincipalChange(e.target.value || null)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-strong max-w-[220px] truncate"
          >
            <option value="">All Principals</option>
            {principals.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-semibold uppercase tracking-wide text-muted">Rep</label>
          <input
            list="report-filters-rep-suggestions"
            value={repInput}
            onChange={(e) => setRepInput(e.target.value)}
            onBlur={commitRep}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRep();
            }}
            placeholder="All reps"
            className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-muted-strong outline-none max-w-[200px]"
          />
          <datalist id="report-filters-rep-suggestions">
            {repSuggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      </div>

      <p className="text-[11px] text-muted">
        Range and Principal apply to every report; Rep only applies to reports with rep-level rows (Coverage, Rep
        Performance, Active Outlets, Timestamps, JP Adherence). Customizing here doesn&apos;t change the live
        dashboard&apos;s own filters.
      </p>
    </div>
  );
}
