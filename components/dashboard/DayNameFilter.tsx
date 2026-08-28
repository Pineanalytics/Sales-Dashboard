"use client";

import { useDashboardStore, ALL_DAY_NAMES } from "@/lib/store";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";

const SHORT_LABELS: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

/** Multi-select Mon-Sun toggle, same segmented-button pattern as RoleToggle.tsx.
 *  Only meaningfully affects the Executive Overview's Week 1-4/Daily Projection
 *  cards (the only tiles with a day-of-week dimension, backed by DailySalesActual)
 *  — every other page's month-grain data has no day dimension to filter, so this
 *  is exposed in the shared filter bar only while Executive MTD is active. */
export function DayNameFilter() {
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const toggleDayName = useDashboardStore((s) => s.toggleDayName);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Day Name</span>
      <div className="grid grid-cols-2 gap-1.5">
        {ALL_DAY_NAMES.map((day) => {
          const active = selectedDayNames.has(day);
          return (
            <button
              key={day}
              onClick={() => toggleDayName(day)}
              className={`rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors duration-200 ${
                active ? "bg-secondary-blue text-white" : "bg-dark-navy text-white/90 hover:bg-primary-blue"
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Compact weekday selector for the shared reporting-period pane. */
export function DayNameSelector() {
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const setDayNames = useDashboardStore((s) => s.setDayNames);
  return (
    <div className="flex items-end rounded-xl border border-border bg-background-elevated px-3 py-2">
      <MultiSelectFilter
        label="Daily breakdown"
        options={ALL_DAY_NAMES.map((day) => ({ value: day, label: SHORT_LABELS[day] }))}
        value={Array.from(selectedDayNames)}
        onChange={setDayNames}
        allLabel="All days"
        className="min-w-[150px]"
      />
    </div>
  );
}
