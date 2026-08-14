import type { Count } from "@/lib/dashboard";

export function StatTile({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: string;
}) {
  return (
    <div className="relative overflow-hidden bg-white border border-[var(--line)] rounded-xl p-4 shadow-[0_1px_2px_rgba(11,11,11,0.04)]">
      <div className="absolute inset-y-0 left-0 w-1 bg-[var(--pine-500)]" />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div>
          <p className="font-mono-label text-[11px] uppercase tracking-wide text-[var(--ink-600)] mb-1">
            {label}
          </p>
          <p className="font-display text-2xl text-[var(--ink-900)] [font-variant-numeric:tabular-nums]">
            {value}
          </p>
          {sub && <p className="text-xs text-[var(--ink-400)] mt-1">{sub}</p>}
        </div>
        {icon && (
          <span className="shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-[var(--pine-100)] text-base">
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)]">
        {title}
      </h2>
      {action}
    </div>
  );
}

export function ChartCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-[var(--line)] rounded-xl p-5 shadow-[0_1px_2px_rgba(11,11,11,0.04)] hover:shadow-[0_2px_8px_rgba(11,11,11,0.06)] transition-shadow">
      <div className="mb-4">
        <h3 className="font-display text-base text-[var(--ink-900)]">{title}</h3>
        {sub && <p className="text-xs text-[var(--ink-400)] mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function BarList({
  data,
  valueSuffix = "",
  emptyLabel = "No data yet.",
  maxRows,
}: {
  data: Count[];
  valueSuffix?: string;
  emptyLabel?: string;
  maxRows?: number;
}) {
  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return <p className="text-sm text-[var(--ink-600)]">{emptyLabel}</p>;
  }
  const shown = maxRows ? data.slice(0, maxRows) : data;
  const max = Math.max(1, ...shown.map((d) => d.count));
  return (
    <div className="space-y-3">
      {shown.map((d) => (
        <div key={d.label} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm mb-1">
            <span className="text-[var(--ink-900)] truncate">{d.label}</span>
            <span className="text-[var(--ink-600)] [font-variant-numeric:tabular-nums] shrink-0">
              {d.count}
              {valueSuffix}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--sand-100)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--pine-500)] group-hover:bg-[var(--pine-700)] transition-colors"
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// A two-segment part-to-whole bar for binary fields (Yes/No, Delivered/Not).
// `criticalLabel`, if given, renders that segment in the reserved critical
// color — only use this when that value genuinely represents a problem.
export function SplitBar({
  counts,
  criticalLabel,
}: {
  counts: Count[];
  criticalLabel?: string;
}) {
  const total = counts.reduce((sum, c) => sum + c.count, 0);
  if (total === 0) {
    return <p className="text-sm text-[var(--ink-600)]">No data yet.</p>;
  }
  return (
    <div>
      <div className="h-3 rounded-full bg-[var(--sand-100)] overflow-hidden flex gap-[2px]">
        {counts
          .filter((c) => c.count > 0)
          .map((c) => (
            <div
              key={c.label}
              className={
                c.label === criticalLabel
                  ? "h-full bg-[var(--rust-600)]"
                  : "h-full bg-[var(--pine-500)]"
              }
              style={{ width: `${(c.count / total) * 100}%` }}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {counts.map((c) => (
          <span key={c.label} className="text-[var(--ink-600)]">
            <span
              className={
                c.label === criticalLabel
                  ? "text-[var(--rust-600)] font-medium"
                  : "text-[var(--pine-700)] font-medium"
              }
            >
              {c.label}
            </span>{" "}
            <span className="[font-variant-numeric:tabular-nums]">
              {c.count} ({total ? Math.round((c.count / total) * 100) : 0}%)
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function DailyTrend({ data }: { data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="flex items-end gap-1.5 h-24">
      {data.map((d) => {
        const day = new Date(d.date + "T00:00:00");
        return (
          <div
            key={d.date}
            className="flex-1 min-w-0 flex flex-col items-center gap-1.5 group"
            title={`${day.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: ${d.count}`}
          >
            <div className="w-full flex items-end h-24">
              <div
                className="w-full rounded-t bg-[var(--pine-500)] group-hover:bg-[var(--pine-700)] transition-colors"
                style={{ height: `${Math.max(3, (d.count / max) * 96)}px` }}
              />
            </div>
            <span className="text-[10px] text-[var(--ink-400)]">
              {day.toLocaleDateString(undefined, { weekday: "narrow" })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
