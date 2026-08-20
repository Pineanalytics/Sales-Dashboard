"use client";

import { useDashboardStore } from "@/lib/store";
import { getAvailableMonths, getAvailableYears, getCurrentMonthPeriod, type PeriodKind, type PeriodSelection } from "@/lib/timeIntelligence";

const PERIOD_KINDS: PeriodKind[] = ["MTD", "MONTH", "QTD", "YTD", "Q1", "Q2", "Q3", "Q4", "H1", "H2"];

const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  MTD: "Month to date",
  MONTH: "Full month",
  QTD: "Quarter to date",
  YTD: "Year to date",
  Q1: "Q1", Q2: "Q2", Q3: "Q3", Q4: "Q4", H1: "H1", H2: "H2", CUSTOM: "Custom",
};

const NEEDS_MONTH: Record<PeriodKind, boolean> = {
  MTD: false, MONTH: true, QTD: true, YTD: true,
  Q1: false, Q2: false, Q3: false, Q4: false, H1: false, H2: false, CUSTOM: true,
};

/** A compact, labelled date control. Native selects keep all periods, years and
 * months visible and keyboard-accessible instead of hiding them in a scroll strip. */
export function PeriodSelector() {
  const dataset = useDashboardStore((s) => s.dataset);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const setPeriod = useDashboardStore((s) => s.setPeriod);
  if (!dataset) return null;

  const years = getAvailableYears(dataset);
  const months = getAvailableMonths(dataset, period.year || years.at(-1) || "");
  const update = (patch: Partial<PeriodSelection>) => setPeriod({ ...period, ...patch });
  const changeKind = (kind: PeriodKind) => {
    if (kind === "MTD") return setPeriod(getCurrentMonthPeriod(dataset));
    const nextYear = period.year || years.at(-1) || "";
    const nextMonths = getAvailableMonths(dataset, nextYear);
    setPeriod({ kind, year: nextYear, month: NEEDS_MONTH[kind] ? period.month ?? nextMonths.at(-1) : period.month });
  };

  return (
    <fieldset className="flex min-w-0 flex-wrap items-end gap-2 rounded-xl border border-border bg-background-elevated px-3 py-2">
      <legend className="sr-only">Reporting date</legend>
      <label className="flex min-w-[130px] flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Reporting period
        <select aria-label="Reporting period" value={period.kind} onChange={(e) => changeKind(e.target.value as PeriodKind)} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary-blue">
          {PERIOD_KINDS.map((kind) => <option key={kind} value={kind}>{PERIOD_KIND_LABELS[kind]}</option>)}
        </select>
      </label>
      <label className="flex min-w-[76px] flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        Year
        <select aria-label="Reporting year" value={period.year} onChange={(e) => update({ year: e.target.value, month: getAvailableMonths(dataset, e.target.value).at(-1) })} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary-blue">
          {years.map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
      </label>
      {NEEDS_MONTH[period.kind] ? (
        <label className="flex min-w-[112px] flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          As at month
          <select aria-label="Reporting month" value={period.month ?? ""} onChange={(e) => update({ month: e.target.value })} className="h-8 rounded-lg border border-border bg-surface px-2 text-xs font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary-blue">
            {months.map((month) => <option key={month} value={month}>{month}</option>)}
          </select>
        </label>
      ) : null}
      {period.kind === "MTD" ? <span className="pb-1 text-xs font-medium normal-case tracking-normal text-primary-blue">Live month</span> : null}
    </fieldset>
  );
}
