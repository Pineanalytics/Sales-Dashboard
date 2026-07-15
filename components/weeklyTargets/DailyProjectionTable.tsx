"use client";

import { useMemo, useState } from "react";
import { DateCalendarPicker } from "@/components/ui/DateCalendarPicker";

export interface DailyProjectionRow {
  id: string;
  date: string; // "YYYY-MM-DD"
  employeeCode: string;
  employeeName: string;
  principal: string;
  teamLeaderName: string;
  targetValue: number;
  sharePctUsed: number;
  weekdayWeightUsed: number;
}

export function DailyProjectionTable({ rows }: { rows: DailyProjectionRow[] }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const availableDates = useMemo(() => Array.from(new Set(rows.map((r) => r.date))), [rows]);
  const filtered = selectedDate ? rows.filter((r) => r.date === selectedDate) : rows;
  const total = filtered.reduce((s, r) => s + r.targetValue, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <DateCalendarPicker availableDates={availableDates} selectedDate={selectedDate} onSelectDate={setSelectedDate} allLabel="All Dates" />
      </div>

      <div className="rounded-2xl bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
        <div className="p-6 pb-0 flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-lg font-semibold text-primary-blue">
            {selectedDate ?? "All dates"} ({filtered.length})
          </h2>
          <span className="text-sm font-medium text-muted-strong">Total: {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <div className="overflow-x-auto mt-4 max-h-[600px]">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-background-elevated text-[13px] uppercase tracking-wide text-muted sticky top-0">
              <tr>
                <th className="px-6 py-3 text-left font-medium">Date</th>
                <th className="px-6 py-3 text-left font-medium">Rep</th>
                <th className="px-6 py-3 text-left font-medium">Team Leader</th>
                <th className="px-6 py-3 text-left font-medium">Principal</th>
                <th className="px-6 py-3 text-right font-medium">Daily Target</th>
                <th className="px-6 py-3 text-right font-medium">Rep Share</th>
                <th className="px-6 py-3 text-right font-medium">Weekday Weight</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="px-6 py-3 border-b border-border/60 whitespace-nowrap">{r.date}</td>
                  <td className="px-6 py-3 border-b border-border/60">
                    {r.employeeName} <span className="text-muted">({r.employeeCode})</span>
                  </td>
                  <td className="px-6 py-3 border-b border-border/60">{r.teamLeaderName}</td>
                  <td className="px-6 py-3 border-b border-border/60">{r.principal}</td>
                  <td className="px-6 py-3 border-b border-border/60 text-right">{r.targetValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td className="px-6 py-3 border-b border-border/60 text-right">{(r.sharePctUsed * 100).toFixed(1)}%</td>
                  <td className="px-6 py-3 border-b border-border/60 text-right">{(r.weekdayWeightUsed * 100).toFixed(1)}%</td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted">
                    No Daily Projection rows for this date.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
