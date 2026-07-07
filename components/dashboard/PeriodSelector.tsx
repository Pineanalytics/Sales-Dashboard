"use client";

import { useDashboardStore } from "@/lib/store";
import { getAvailableYears, getAvailableMonths, type PeriodKind, type PeriodSelection } from "@/lib/timeIntelligence";

const PERIOD_KINDS: PeriodKind[] = ["MTD", "MONTH", "QTD", "YTD", "Q1", "Q2", "Q3", "Q4", "H1", "H2"];

const PERIOD_KIND_LABELS: Record<PeriodKind, string> = {
  MTD: "MTD",
  MONTH: "Month",
  QTD: "QTD",
  YTD: "YTD",
  Q1: "Q1",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4",
  H1: "H1",
  H2: "H2",
};

// Full-period kinds (Q1-Q4/H1/H2) don't need a reference month — MTD/MONTH/QTD/YTD
// all resolve relative to one.
const NEEDS_MONTH: Record<PeriodKind, boolean> = {
  MTD: true,
  MONTH: true,
  QTD: true,
  YTD: true,
  Q1: false,
  Q2: false,
  Q3: false,
  Q4: false,
  H1: false,
  H2: false,
};

/** Global period selector — every view reads `period` from the store, so this
 *  renders once (in the header) rather than being duplicated per-view. */
export function PeriodSelector() {
  const dataset = useDashboardStore((s) => s.dataset);
  const period = useDashboardStore((s) => s.selectedPeriod);
  const setPeriod = useDashboardStore((s) => s.setPeriod);

  if (!dataset) return null;

  const years = getAvailableYears(dataset);
  const months = getAvailableMonths(dataset, period.year || years[years.length - 1] || "");

  function update(patch: Partial<PeriodSelection>) {
    setPeriod({ ...period, ...patch });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Year"
        value={period.year}
        onChange={(e) => update({ year: e.target.value })}
        className="rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white [&>option]:text-foreground"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <div className="flex flex-wrap rounded-full bg-white/10 p-0.5">
        {PERIOD_KINDS.map((k) => {
          const active = period.kind === k;
          return (
            <button
              key={k}
              onClick={() => update({ kind: k })}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${
                active ? "bg-white text-primary-blue shadow-cyan-glow" : "text-white/80 hover:text-brand-orange"
              }`}
            >
              {PERIOD_KIND_LABELS[k]}
            </button>
          );
        })}
      </div>

      {NEEDS_MONTH[period.kind] ? (
        <select
          aria-label="Month"
          value={period.month ?? ""}
          onChange={(e) => update({ month: e.target.value })}
          className="rounded-full border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white [&>option]:text-foreground"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
