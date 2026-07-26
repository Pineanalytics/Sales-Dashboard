"use client";

import { useDashboardStore, ALL_DAY_NAMES } from "@/lib/store";

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
 *  is rendered only on the dashboard, not added to the always-visible GlobalFilterBar. */
export function DayNameFilter() {
  const selectedDayNames = useDashboardStore((s) => s.selectedDayNames);
  const toggleDayName = useDashboardStore((s) => s.toggleDayName);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Day Name</span>
      <div className="flex flex-wrap gap-1 rounded-2xl bg-background-elevated p-1">
        {ALL_DAY_NAMES.map((day) => {
          const active = selectedDayNames.has(day);
          return (
            <button
              key={day}
              onClick={() => toggleDayName(day)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-300 ${
                active ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"
              }`}
            >
              {SHORT_LABELS[day]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
