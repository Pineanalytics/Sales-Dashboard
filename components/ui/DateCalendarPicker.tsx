"use client";

import { useMemo, useState } from "react";
import { ChevronLeft20Regular, ChevronRight20Regular } from "@fluentui/react-icons";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface DateCalendarPickerProps {
  /** "YYYY-MM-DD" strings, any order, may contain duplicates. */
  availableDates: string[];
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
  /** Label for the reset-to-everything button, e.g. "All Month" / "All Dates". */
  allLabel: string;
}

/** Month-at-a-time calendar grid, replacing a flat horizontally-scrolling date-pill
 *  row: a month selector (prev/next) up top scopes which days show below, so picking
 *  a date on a 90-day window doesn't mean scrolling through ~90 pills. Only days
 *  present in `availableDates` are clickable; everything else renders greyed out.
 *  Shared by the Timestamps and JP Adherence pages (previously each had its own
 *  duplicated pill-row implementation). */
export function DateCalendarPicker({ availableDates, selectedDate, onSelectDate, allLabel }: DateCalendarPickerProps) {
  const availableSet = useMemo(() => new Set(availableDates), [availableDates]);
  const months = useMemo(() => Array.from(new Set(availableDates.map((d) => d.slice(0, 7)))).sort(), [availableDates]);

  const [viewMonth, setViewMonth] = useState<string | null>(() => (selectedDate ? selectedDate.slice(0, 7) : (months[months.length - 1] ?? null)));

  const monthIndex = viewMonth ? months.indexOf(viewMonth) : -1;
  const canGoPrev = monthIndex > 0;
  const canGoNext = monthIndex >= 0 && monthIndex < months.length - 1;

  const [viewYear, viewMonthNum] = (viewMonth ?? months[0] ?? "1970-01").split("-").map(Number);

  const grid = useMemo(() => {
    if (!viewMonth) return [];
    const first = new Date(Date.UTC(viewYear, viewMonthNum - 1, 1));
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonthNum, 0)).getUTCDate();
    const firstWeekday = first.getUTCDay(); // 0=Sun..6=Sat
    const cells: ({ day: number; dateStr: string } | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ day, dateStr: `${viewYear}-${String(viewMonthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}` });
    }
    return cells;
  }, [viewMonth, viewYear, viewMonthNum]);

  const monthLabel = viewMonth ? new Date(Date.UTC(viewYear, viewMonthNum - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : "—";

  if (months.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
      <div className="flex max-w-xs flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <button
            onClick={() => canGoPrev && setViewMonth(months[monthIndex - 1])}
            disabled={!canGoPrev}
            aria-label="Previous month"
            className="rounded-full p-1.5 text-muted-strong transition-colors hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronLeft20Regular />
          </button>
          <span className="text-sm font-semibold text-foreground">{monthLabel}</span>
          <button
            onClick={() => canGoNext && setViewMonth(months[monthIndex + 1])}
            disabled={!canGoNext}
            aria-label="Next month"
            className="rounded-full p-1.5 text-muted-strong transition-colors hover:text-primary-blue disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ChevronRight20Regular />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted">
          {WEEKDAY_LABELS.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((cell, i) => {
            if (!cell) return <div key={`empty-${i}`} />;
            const has = availableSet.has(cell.dateStr);
            const active = selectedDate === cell.dateStr;
            return (
              <button
                key={cell.dateStr}
                disabled={!has}
                onClick={() => onSelectDate(cell.dateStr)}
                className={`aspect-square rounded-lg text-xs font-semibold transition-all duration-200 ${
                  active
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : has
                      ? "bg-background-elevated text-foreground hover:bg-accent-blue-soft hover:text-primary-blue"
                      : "cursor-not-allowed text-muted/40"
                }`}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </div>
      <button
        onClick={() => onSelectDate(null)}
        className={`shrink-0 self-start rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 ${
          !selectedDate
            ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
            : "bg-background-elevated text-muted-strong hover:text-primary-blue"
        }`}
      >
        {allLabel}
      </button>
    </div>
  );
}
