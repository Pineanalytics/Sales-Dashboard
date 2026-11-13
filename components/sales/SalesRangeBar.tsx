"use client";

import { useDashboardStore } from "@/lib/store";
import { daysInRange, MAX_RANGE_DAYS, nairobiToday, rangePresets, type RangeGroupBy } from "@/lib/salesRange";

const GROUP_LABELS: Record<RangeGroupBy, string> = { day: "Day", week: "Week", month: "Month" };

/** Switches Sales Performance between the reporting-period view (the global
 *  period filter, monthly figures) and a date range on the SAP daily feed,
 *  with quick ranges, exact From/To dates and Day / Week / Month grouping. */
export function SalesRangeBar() {
  const range = useDashboardStore((s) => s.salesRange);
  const setRange = useDashboardStore((s) => s.setSalesRange);
  const today = nairobiToday();
  const presets = rangePresets(today);
  const activePreset = range ? presets.find((preset) => preset.from === range.from && preset.to === range.to)?.id ?? "custom" : "custom";

  const segment = (active: boolean) =>
    `rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-primary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"}`;
  const fieldLabel = "flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted";
  const control = "h-8 rounded-lg border border-border bg-surface px-2 text-xs font-semibold normal-case tracking-normal text-foreground outline-none focus:border-primary-blue";

  const setDates = (from: string, to: string) => {
    if (!range) return;
    // Keep from ≤ to and the span within the API's limit by moving the other end.
    let nextFrom = from;
    let nextTo = to;
    if (nextFrom > nextTo) [nextFrom, nextTo] = [nextTo, nextFrom];
    if (daysInRange(nextFrom, nextTo) > MAX_RANGE_DAYS) return;
    setRange({ ...range, from: nextFrom, to: nextTo });
  };

  return (
    <section aria-label="Sales date range" className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-sm">
      <div className={fieldLabel}>
        View by
        <div className="inline-flex rounded-full border border-border bg-background-elevated p-0.5">
          <button type="button" aria-pressed={!range} onClick={() => setRange(null)} className={segment(!range)}>
            Reporting period
          </button>
          <button
            type="button"
            aria-pressed={Boolean(range)}
            onClick={() => {
              if (range) return;
              const thisMonth = presets.find((preset) => preset.id === "this-month")!;
              setRange({ from: thisMonth.from, to: thisMonth.to, groupBy: thisMonth.groupBy });
            }}
            className={segment(Boolean(range))}
          >
            Date range
          </button>
        </div>
      </div>

      {range ? (
        <>
          <label className={fieldLabel}>
            Quick range
            <select
              aria-label="Quick range"
              value={activePreset}
              onChange={(event) => {
                const preset = presets.find((item) => item.id === event.target.value);
                if (preset) setRange({ from: preset.from, to: preset.to, groupBy: preset.groupBy });
              }}
              className={`${control} min-w-[130px]`}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom" disabled>
                Custom dates
              </option>
            </select>
          </label>
          <label className={fieldLabel}>
            From
            <input type="date" aria-label="From date" value={range.from} max={today} onChange={(event) => event.target.value && setDates(event.target.value, range.to)} className={control} />
          </label>
          <label className={fieldLabel}>
            To
            <input type="date" aria-label="To date" value={range.to} max={today} onChange={(event) => event.target.value && setDates(range.from, event.target.value)} className={control} />
          </label>
          <div className={fieldLabel}>
            Group by
            <div className="inline-flex rounded-full border border-border bg-background-elevated p-0.5">
              {(Object.keys(GROUP_LABELS) as RangeGroupBy[]).map((groupBy) => (
                <button key={groupBy} type="button" aria-pressed={range.groupBy === groupBy} onClick={() => setRange({ ...range, groupBy })} className={segment(range.groupBy === groupBy)}>
                  {GROUP_LABELS[groupBy]}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-1.5 text-[11px] text-muted">
            {daysInRange(range.from, range.to)} day{daysInRange(range.from, range.to) === 1 ? "" : "s"} · SAP daily sales · up to {MAX_RANGE_DAYS} days
          </p>
        </>
      ) : (
        <p className="mb-1.5 text-[11px] text-muted">Monthly figures for the reporting period above. Switch to Date range to pick exact dates and group by day, week or month.</p>
      )}
    </section>
  );
}
