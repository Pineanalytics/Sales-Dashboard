"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatCompact } from "@/lib/format";
import { CHART_COLORS } from "@/components/charts/theme";

export const PALETTE = CHART_COLORS;
/** Colour for "everything else" in stacked charts and doughnuts. */
export const OTHERS_COLOR = "#b8c9b4";

const MONTH_ABBREV = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" -> "Sep". */
export const monthShort = (month: string): string => MONTH_ABBREV[Number(month.slice(5, 7)) - 1] ?? month;

export const kes = (value: number | null | undefined): string => (value === null || value === undefined ? "–" : `KES ${formatCompact(value)}`);
export const compact = (value: number | null | undefined): string => (value === null || value === undefined ? "–" : formatCompact(value));
export const millions = (value: number | null | undefined): string => (value === null || value === undefined ? "–" : (value / 1e6).toFixed(1));
export const pct = (value: number | null | undefined, places = 1): string => (value === null || value === undefined || !Number.isFinite(value) ? "–" : `${value.toFixed(places)}%`);
export const count = (value: number | null | undefined): string => (value === null || value === undefined ? "–" : Math.round(value).toLocaleString("en-US"));

/** A signed growth figure, green when up and red when down. */
export function Growth({ value, places = 1 }: { value: number | null | undefined; places?: number }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted">{"–"}</span>;
  return <span className={value >= 0 ? "text-emerald-600" : "text-red-600"}>{`${value >= 0 ? "+" : ""}${value.toFixed(places)}%`}</span>;
}

/** Tiny inline line of monthly values with the latest point marked. */
export function Spark({ values, width = 90, height = 22 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values, 0);
  const sx = width / (values.length - 1);
  const sy = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const points = values.map((v, i) => `${(i * sx).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  return (
    <svg className="inline-block align-middle" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points} fill="none" stroke="#24754f" strokeWidth="1.6" />
      <circle cx={((values.length - 1) * sx).toFixed(1)} cy={sy(values[values.length - 1]).toFixed(1)} r="2.2" fill="#b2863f" />
    </svg>
  );
}

/** Renders **bold** markers from the generated commentary. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : <span key={index}>{part}</span>))}
    </>
  );
}

export function Lede({ children }: { children: ReactNode }) {
  return <p className="mb-4 max-w-[85ch] text-sm text-muted-strong">{children}</p>;
}

/** The amber call-out under a panel. */
export function Note({ children }: { children: ReactNode }) {
  return <div className="mt-3 rounded-r-md border-l-[3px] border-amber-500 bg-background-elevated px-3.5 py-2.5 text-[13px] text-foreground">{children}</div>;
}

export function SectionHeading({ id, title, lede }: { id: string; title: string; lede?: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-4">
      <h2 className="text-[22px] font-semibold text-foreground">{title}</h2>
      {lede ? <Lede>{lede}</Lede> : <div className="mb-3" />}
    </div>
  );
}

/** A white panel with a small title, used for every chart and table block. */
export function Panel({ title, hint, action, children, className = "" }: { title?: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl bg-surface p-4 shadow-[0_1px_3px_rgba(11,61,53,0.06)] ring-1 ring-black/[0.06] ${className}`}>
      {title || action ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? (
            <h3 className="text-sm font-semibold text-foreground">
              {title}
              {hint ? <span className="ml-2 text-xs font-normal text-muted">{hint}</span> : null}
            </h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Segmented single-choice control. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="inline-flex flex-wrap rounded-full bg-background-elevated p-1" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
            value === option.value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-sm" : "text-muted-strong hover:text-primary-blue"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface Column<T> {
  header: ReactNode;
  /** Plain-text header used for the sort control's accessible name. */
  id: string;
  align?: "left" | "right";
  render: (row: T, index: number) => ReactNode;
  /** Present => the column sorts on this value (click the header). */
  sortValue?: (row: T) => number | string | null;
  cellStyle?: (row: T) => CSSProperties | undefined;
  cellClassName?: string;
}

/** Table whose sortable headers re-order the rows, with the dashboard's table look. */
export function SortableTable<T>({ columns, rows, rowKey, maxHeight }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T, index: number) => string; maxHeight?: number }) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);

  const ordered = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return rows;
    const value = column.sortValue;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, columns, sort]);

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-[1] bg-dark-navy text-[12px] uppercase tracking-wide text-white/85">
            <tr>
              {columns.map((column) => {
                const active = sort?.id === column.id;
                const sortable = Boolean(column.sortValue);
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? (sort!.dir === -1 ? "descending" : "ascending") : undefined}
                    className={`whitespace-nowrap border-b border-white/10 px-3 py-2.5 font-medium ${column.align === "left" ? "text-left" : "text-right"} ${sortable ? "cursor-pointer select-none hover:text-white" : ""}`}
                    onClick={sortable ? () => setSort(active ? { id: column.id, dir: sort!.dir === -1 ? 1 : -1 } : { id: column.id, dir: -1 }) : undefined}
                  >
                    {column.header}
                    {active ? (sort!.dir === -1 ? " ▾" : " ▴") : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {ordered.map((row, index) => (
              <tr key={rowKey(row, index)} className="hover:bg-background-elevated/60">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`whitespace-nowrap border-b border-border/60 px-3 py-1.5 ${column.align === "left" ? "text-left" : "text-right"} ${column.cellClassName ?? ""}`}
                    style={column.cellStyle?.(row)}
                  >
                    {column.render(row, index)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A name cell that truncates long labels and keeps the full text on hover. */
export function NameCell({ name, tag }: { name: string; tag?: string }) {
  return (
    <span className="inline-block max-w-[280px] truncate align-middle" title={name}>
      {name}
      {tag ? <span className="ml-1.5 rounded bg-background-elevated px-1.5 py-px text-[11px] text-muted">{tag}</span> : null}
    </span>
  );
}
