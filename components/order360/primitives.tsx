"use client";

import { O360, AGE_COLOR, ageClass, fmtKES, fmtNum } from "./theme";

export function O360Panel({ title, note, action, children, className = "" }: { title?: string; note?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border ${O360.borderSoft} p-4 sm:p-5 ${className}`} style={{ background: O360.panel }}>
      {title ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold tracking-wide text-white/95">{title}</div>
            {note ? <div className={`mt-0.5 text-[11px] ${O360.textMuted}`}>{note}</div> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

const KPI_ACCENTS: Record<string, string> = {
  neutral: O360.accent,
  good: O360.good,
  warn: O360.warn,
  bad: O360.bad,
  gold: O360.gold,
};

export function O360KpiCard({ label, value, sub, accent = "neutral" }: { label: string; value: string; sub?: string; accent?: keyof typeof KPI_ACCENTS }) {
  return (
    <div className={`rounded-xl border ${O360.borderSoft} p-3.5`} style={{ background: O360.panelSoft, borderLeft: `3px solid ${KPI_ACCENTS[accent]}` }}>
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${O360.textMuted}`}>{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
      {sub ? <div className={`mt-0.5 text-[11px] ${O360.textFaint}`}>{sub}</div> : null}
    </div>
  );
}

export function O360KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{children}</div>;
}

export function O360AgeBadge({ age }: { age: number }) {
  const cls = ageClass(age);
  const color = AGE_COLOR[cls];
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${color}22`, color }}>
      {age}d
    </span>
  );
}

export function O360ReturnBadge({ returned, returnType }: { returned?: boolean; returnType?: string | null }) {
  if (!returned) return <span className={`text-[11px] ${O360.textMuted}`}>In transit</span>;
  const color = returnType === "Partial" ? O360.warn : O360.bad;
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${color}22`, color }}>
      Returned{returnType ? ` (${returnType})` : ""}
    </span>
  );
}

export function O360Callout({ tag, tone = "neutral", children, cta }: { tag: string; tone?: "neutral" | "warn" | "info" | "bad"; children: React.ReactNode; cta?: { label: string; onClick: () => void } }) {
  const toneColor = tone === "warn" ? O360.warn : tone === "bad" ? O360.bad : tone === "info" ? O360.accent : "#8a94ae";
  return (
    <div className={`rounded-xl border ${O360.borderSoft} p-3.5`} style={{ background: O360.panelSoft }}>
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: `${toneColor}22`, color: toneColor }}>
        {tag}
      </span>
      <p className={`mt-2 text-[13px] leading-relaxed ${O360.text}`}>{children}</p>
      {cta ? (
        <button onClick={cta.onClick} className="mt-2 text-[12px] font-semibold hover:underline" style={{ color: O360.accent }}>
          {cta.label} &rarr;
        </button>
      ) : null}
    </div>
  );
}

export function O360StatPair({ doneLabel, doneCount, doneValue, pendingLabel, pendingCount, pendingValue }: { doneLabel: string; doneCount: number; doneValue: number; pendingLabel: string; pendingCount: number; pendingValue: number }) {
  const total = doneCount + pendingCount;
  const donePct = total ? Math.round((doneCount / total) * 100) : 0;
  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border p-3.5" style={{ background: `${O360.good}14`, borderColor: `${O360.good}33` }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: O360.good }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: O360.good }} />
            {doneLabel}
          </div>
          <div className="mt-1 text-lg font-bold text-white">{fmtNum(doneCount)}</div>
          <div className={`text-[11px] ${O360.textFaint}`}>{fmtKES(doneValue, true)} processed</div>
        </div>
        <div className="rounded-xl border p-3.5" style={{ background: `${O360.warn}14`, borderColor: `${O360.warn}33` }}>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: O360.warn }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: O360.warn }} />
            {pendingLabel}
          </div>
          <div className="mt-1 text-lg font-bold text-white">{fmtNum(pendingCount)}</div>
          <div className={`text-[11px] ${O360.textFaint}`}>{fmtKES(pendingValue, true)} waiting</div>
        </div>
      </div>
      <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-white/10">
        <div style={{ width: `${donePct}%`, background: O360.good }} />
        <div style={{ width: `${100 - donePct}%`, background: O360.warn }} />
      </div>
      <div className={`mt-1.5 text-[11px] ${O360.textMuted}`}>{donePct}% of orders that reached this gate have cleared it.</div>
    </div>
  );
}
