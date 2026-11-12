const SYSTEMS = [
  { key: "pine", principal: "Pine", system: "SalesEdge", short: "SalesEdge", description: "Standard timestamp and time-management activity." },
  { key: "eabl", principal: "EABL", system: "DMS", short: "DMS", description: "Dedicated call performance and customer visit detail." },
  // DataEdge (sales) and Outlet Visits (FSR check-in/check-out) are two feeds
  // from the same source machine with two different grains, kept as separate
  // pages/APIs — one system here; UpfieldReportTabs switches between them
  // from inside either page, defaulting to DataEdge.
  { key: "upfield", principal: "Upfield", system: "DataEdge · Outlet Visits", short: "DataEdge", description: "Transaction timestamps, productive outlet coverage, and FSR check-in/check-out." },
  { key: "unilever", principal: "Unilever", system: "Leverage", short: "Leverage", description: "PJP/route daily activity and entry-time tracking from the field DMS." },
] as const;

export type SfaSystemKey = "pine" | "eabl" | "upfield" | "unilever";

/** The Timestamp system picker — a compact dropdown, styled like the
 *  Principal filter, that sits first in a report's filter row. It switches
 *  systems through local state (onNavigate), not routing: every system now
 *  lives inside Coverage & Productivity's "Time in Trade" tab. */
export function TimestampSystemSelect({ current, onNavigate }: { current: SfaSystemKey; onNavigate: (key: SfaSystemKey) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Timestamp system</span>
      <div className="flex items-center rounded-full border border-primary-blue/40 bg-accent-blue-soft px-3 py-1.5">
        <select
          aria-label="Timestamp system"
          value={current}
          onChange={(event) => onNavigate(event.target.value as SfaSystemKey)}
          className="max-w-[170px] bg-transparent text-xs font-semibold text-primary-blue outline-none"
        >
          {SYSTEMS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.principal} · {item.short}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** A one-line system bar for the EABL, Upfield and Unilever reports, whose
 *  own filters sit below it: the system dropdown plus what that system tracks.
 *  (Pine puts the dropdown straight into its own filter row instead.) */
export function SfaReportNavigator({ current = "pine", onNavigate }: { current?: SfaSystemKey; onNavigate: (key: SfaSystemKey) => void }) {
  const active = SYSTEMS.find((item) => item.key === current) ?? SYSTEMS[0];
  return (
    <section className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface px-4 py-3 shadow-[0_4px_14px_rgba(11,61,53,0.08)]">
      <TimestampSystemSelect current={current} onNavigate={onNavigate} />
      <p className="mb-1.5 text-xs text-muted">
        <span className="font-semibold text-brand-navy">{active.principal}</span> · {active.system} — {active.description}
      </p>
    </section>
  );
}
