// How the call analysis is shown and exported: formats, date presets and the Excel content. No database, no React.
import type { ReportContent } from "@/lib/reports/types";
import { CALL_GROUP_OPTIONS, CALL_SOURCE_LABELS, type CallAnalysisResult, type CallMetrics, type CallRow } from "./types";

export function clockTime(minutes: number | null): string {
  if (minutes === null) return "—";
  const total = Math.round(minutes) % (24 * 60);
  const hour = Math.floor(total / 60);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(total % 60).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export function figure(value: number | null, digits = 0, suffix = ""): string {
  if (value === null) return "—";
  return `${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

/** A line under a figure that rests on only part of the productive calls; null when it rests on all of them. */
export function partialNote(dataPct: number | null, what: string): string | null {
  if (dataPct === null || dataPct >= 99.95) return null;
  return `${what} recorded on ${dataPct.toFixed(0)}% of productive calls; worked out from those.`;
}

export type DatePreset = "today" | "yesterday" | "week" | "last7" | "month" | "lastMonth" | "custom";

export const DATE_PRESETS: readonly { key: DatePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "last7", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "lastMonth", label: "Last month" },
];

const iso = (value: Date) => value.toISOString().slice(0, 10);

/** Today's date in Nairobi. */
export function nairobiToday(now = new Date()): string {
  return iso(new Date(now.getTime() + 3 * 60 * 60 * 1000));
}

/** A whole month, "YYYY-MM"; the current one stops at today. */
export function monthRange(month: string, today: string): { from: string; to: string } {
  const [year, number] = month.split("-").map(Number);
  const last = iso(new Date(Date.UTC(year, number, 0)));
  return { from: `${month}-01`, to: last > today && month <= today.slice(0, 7) ? today : last };
}

export function presetRange(preset: Exclude<DatePreset, "custom">, today: string): { from: string; to: string } {
  const day = new Date(`${today}T00:00:00.000Z`);
  const back = (days: number) => iso(new Date(day.getTime() - days * 86_400_000));
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: back(1), to: back(1) };
    case "week":
      return { from: back((day.getUTCDay() + 6) % 7), to: today };
    case "last7":
      return { from: back(6), to: today };
    case "month":
      return monthRange(today.slice(0, 7), today);
    case "lastMonth":
      return monthRange(iso(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1))).slice(0, 7), today);
  }
}

export const DEFINITIONS: readonly [string, string][] = [
  ["Call", "A rep at an outlet on a day. Productive when there was a sale or order."],
  ["Strike rate", "Productive calls divided by calls. Leverage records only invoices, so it has no calls and is left out of this figure."],
  ["Coverage", "Different outlets called on (Leverage: invoiced), each counted once per month; over several months, the monthly average."],
  ["LPPC", "Lines per productive call: different products sold or ordered at the outlet that day, averaged over productive calls. EABL DMS records no product lines."],
  ["Drop size (KES)", "Sales value per productive call. Pine's value is sales and orders, as on the Timestamps report."],
  ["Drop size (cases)", "Cases per productive call, from the calls whose cases are known (Pine and Leverage)."],
  ["Start and close", "Average first and last activity of a rep's day, over working days. Late start: after 9:30 AM."],
  ["Start and close (Pine)", "The first and last outlet the rep opened in the Pine app between 6:00 AM and 8:00 PM. A sale, order or no-sale earlier or later than those counts instead."],
  ["Start and close (other systems)", "Upfield and Leverage record only transactions, so their day runs from the first to the last one."],
];

const COLUMNS = [
  "Reps", "Rep-days", "Avg start", "Avg close", "Hours in trade", "Late starts %", "Avg mins between calls", "Calls", "Calls per rep-day",
  "Productive calls", "Strike rate %", "Outlets covered", "Outlets bought", "LPPC", "LPPC data %", "Sales value", "Drop size (KES)",
  "Cases", "Drop size (cases)", "Cases data %",
];

function values(m: CallMetrics): (string | number)[] {
  const n = (value: number | null) => value ?? "";
  return [
    m.reps, m.repDays,
    m.avgStartMinutes === null ? "" : clockTime(m.avgStartMinutes),
    m.avgCloseMinutes === null ? "" : clockTime(m.avgCloseMinutes),
    n(m.avgHours), n(m.lateStartPct), n(m.avgIntervalMins), n(m.calls), n(m.callsPerRepDay), m.productive, n(m.strikeRatePct),
    m.coverage, m.productiveCoverage, n(m.lppc), n(m.lppcDataPct), m.value, n(m.dropSizeValue), n(m.cases), n(m.dropSizeCases), n(m.casesDataPct),
  ];
}

export function toReport(result: CallAnalysisResult, filters: [string, string][], generatedAt = new Date()): ReportContent {
  const groupLabel = CALL_GROUP_OPTIONS.find((option) => option.key === result.groupBy)!.label;
  const section = (title: string, heading: string, rows: CallRow[], withDetail: boolean) => ({
    title,
    columns: [heading, ...(withDetail ? ["Detail"] : []), ...COLUMNS],
    rows: [
      ...rows.map((row) => [row.label, ...(withDetail ? [row.detail ?? ""] : []), ...values(row)]),
      ["Total", ...(withDetail ? [""] : []), ...values(result.total)],
    ],
  });
  const withDetail = result.groupBy === "rep" || result.groupBy === "repDay";
  return {
    title: `Call analysis ${result.from} to ${result.to}`,
    generatedAt,
    summary: filters.map(([label, value]) => ({ label, value })),
    sections: [
      section(`By ${groupLabel.toLowerCase()}`, groupLabel, result.rows, withDetail),
      ...(result.groupBy === "day" ? [] : [section("By day", "Day", result.trend, false)]),
      {
        title: "Definitions",
        columns: ["Figure", "Meaning"],
        rows: [
          ...DEFINITIONS.map(([name, meaning]) => [name, meaning]),
          ...result.availability.map((a) => [`${CALL_SOURCE_LABELS[a.source]} data held`, a.first ? `${a.first} to ${a.last}` : "None"]),
        ],
      },
    ],
  };
}
