"use client";

import { useEffect, useMemo, useState } from "react";
import type { SectionDefinition, MetricDefinition } from "@/lib/performanceTracker/definitions";
import { computeHodScore, vsTargetTier, type Grade } from "@/lib/performanceTracker/scoring";

interface MetricRow {
  metricKey: string;
  target: number | null;
  actual: number | null;
}
interface TrackerData {
  id: string;
  periodMonth: string;
  reviewedByName: string | null;
  mdDiscretionaryPct: number | null;
  status: string;
  reviewComments: string | null;
  metrics: MetricRow[];
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatMetric(value: number | null, unit: MetricDefinition["unit"]): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (unit === "pct") return `${(value * 100).toFixed(1)}%`;
  if (unit === "kes") return `KES ${Math.round(value).toLocaleString()}`;
  return value.toLocaleString();
}

const TIER_CLASS: Record<string, string> = {
  good: "bg-[var(--pine-100,#e7f0e5)] text-[var(--pine-700,#155b4a)]",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-rose-100 text-rose-700",
  neutral: "bg-gray-100 text-gray-600",
};
const GRADE_CLASS: Record<Grade, string> = {
  A: "bg-emerald-600 text-white",
  B: "bg-lime-500 text-white",
  C: "bg-amber-500 text-white",
  D: "bg-orange-600 text-white",
  F: "bg-rose-700 text-white",
};

export default function HodTrackerClient({ canEditValues, canReview }: { canEditValues: boolean; canReview: boolean }) {
  const [period, setPeriod] = useState(currentPeriod());
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [sections, setSections] = useState<SectionDefinition[]>([]);
  const [tracker, setTracker] = useState<TrackerData | null>(null);
  const [values, setValues] = useState<Map<string, MetricRow>>(new Map());
  const [reviewedByName, setReviewedByName] = useState("");
  const [mdDiscretionaryPct, setMdDiscretionaryPct] = useState<string>("");
  const [trackerStatus, setTrackerStatus] = useState("draft");
  const [reviewComments, setReviewComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(`/api/performance-tracker?type=HOD&period=${period}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load.");
        if (cancelled) return;
        setSections(body.sections);
        setTracker(body.tracker);
        setValues(new Map(body.tracker.metrics.map((m: MetricRow) => [m.metricKey, m])));
        setReviewedByName(body.tracker.reviewedByName ?? "");
        setMdDiscretionaryPct(body.tracker.mdDiscretionaryPct != null ? String(body.tracker.mdDiscretionaryPct * 100) : "");
        setTrackerStatus(body.tracker.status);
        setReviewComments(body.tracker.reviewComments ?? "");
        setStatus("idle");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  function setField(key: string, field: "target" | "actual", raw: string) {
    setValues((prev) => {
      const next = new Map(prev);
      const existing = next.get(key) ?? { metricKey: key, target: null, actual: null };
      next.set(key, { ...existing, [field]: raw === "" ? null : Number(raw) });
      return next;
    });
  }

  function metricValue(key: string, field: "target" | "actual"): number | null {
    return values.get(key)?.[field] ?? null;
  }

  const percentMap = new Map<string, number | null>();
  for (const section of sections) {
    for (const m of section.metrics) {
      if (m.computedFrom) {
        const num = metricValue(m.computedFrom.numerator, "actual");
        const den = metricValue(m.computedFrom.denominator, "actual");
        percentMap.set(m.key, num !== null && den ? num / den : null);
      } else {
        const target = metricValue(m.key, "target");
        const actual = metricValue(m.key, "actual");
        percentMap.set(m.key, target && actual !== null ? actual / target : null);
      }
    }
  }

  const score = useMemo(() => computeHodScore(values, mdDiscretionaryPct === "" ? null : Number(mdDiscretionaryPct) / 100), [values, mdDiscretionaryPct]);

  async function save() {
    if (!tracker) return;
    setSaving(true);
    const res = await fetch("/api/performance-tracker", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "HOD",
        periodMonth: period,
        metrics: Array.from(values.values()),
        reviewedByName,
        mdDiscretionaryPct: mdDiscretionaryPct === "" ? null : Number(mdDiscretionaryPct) / 100,
        status: canReview ? trackerStatus : undefined,
        reviewComments: canReview ? reviewComments : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt((t) => (t === null ? null : null)), 3000);
    }
  }

  if (status === "loading") return <div className="p-8 text-sm text-muted">Loading HOD Performance Tracker…</div>;
  if (status === "error" || !tracker) return <div className="p-8 text-sm text-rose-600">Couldn&apos;t load the tracker. Try refreshing.</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600,#1f6a4e)] mb-1">Head of Sales</p>
          <h1 className="text-2xl font-semibold">MD Performance Review</h1>
          <p className="text-sm text-muted mt-1">Company-wide — six KPI pillars, weighted score, and grade, reviewed by the MD/Director.</p>
        </div>
        <div className="flex items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Period
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
          </label>
          <div className="flex flex-col items-center rounded-xl border border-border px-4 py-2">
            <span className="text-[10px] uppercase tracking-wide text-muted">Weighted Score</span>
            <span className="text-xl font-semibold">{(score.pct * 100).toFixed(1)}%</span>
          </div>
          <span className={`rounded-full px-3 py-2 text-sm font-bold ${GRADE_CLASS[score.grade]}`}>{score.grade}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Reviewed by
          <input
            disabled={!canEditValues}
            value={reviewedByName}
            onChange={(e) => setReviewedByName(e.target.value)}
            placeholder="MD / Director name"
            className="rounded-md border border-border px-2 py-1.5 text-sm disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          MD Discretionary (0–5%)
          <input
            disabled={!canEditValues}
            type="number"
            min={0}
            max={5}
            step={0.5}
            value={mdDiscretionaryPct}
            onChange={(e) => setMdDiscretionaryPct(e.target.value)}
            className="rounded-md border border-border px-2 py-1.5 text-sm disabled:opacity-60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Status
          <select disabled={!canReview} value={trackerStatus} onChange={(e) => setTrackerStatus(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm disabled:opacity-60">
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Review comments
          <input
            disabled={!canReview}
            value={reviewComments}
            onChange={(e) => setReviewComments(e.target.value)}
            placeholder="MD/Director notes"
            className="rounded-md border border-border px-2 py-1.5 text-sm disabled:opacity-60"
          />
        </label>
      </div>

      {sections.map((section) => (
        <div key={section.key} className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-border font-medium">{section.label}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border/60">
                <th className="py-2 px-4">KPI / Metric</th>
                <th className="py-2 px-4 text-right">Target</th>
                <th className="py-2 px-4 text-right">Actual</th>
                <th className="py-2 px-4 text-center">Vs Target %</th>
              </tr>
            </thead>
            <tbody>
              {section.metrics.map((m) => {
                if (m.computedFrom) {
                  const pct = percentMap.get(m.key);
                  return (
                    <tr key={m.key} className="border-b border-border/40">
                      <td className="py-2 px-4 text-muted-strong">{m.label}</td>
                      <td className="py-2 px-4 text-right text-muted">—</td>
                      <td className="py-2 px-4 text-right font-medium">{pct !== null && pct !== undefined ? formatMetric(pct, "pct") : "—"}</td>
                      <td className="py-2 px-4 text-center">
                        {pct !== null && pct !== undefined ? (
                          <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_CLASS[vsTargetTier(pct)]}`}>{(pct * 100).toFixed(0)}%</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                }
                const target = metricValue(m.key, "target");
                const actual = metricValue(m.key, "actual");
                const pct = percentMap.get(m.key);
                return (
                  <tr key={m.key} className="border-b border-border/40">
                    <td className="py-2 px-4 text-muted-strong">
                      {m.label}
                      {m.weight ? <span className="ml-1 text-[10px] text-muted">({(m.weight * 100).toFixed(0)}%)</span> : null}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <input
                        disabled={!canEditValues}
                        type="number"
                        value={target ?? ""}
                        onChange={(e) => setField(m.key, "target", e.target.value)}
                        className="w-32 rounded-md border border-border px-2 py-1 text-right text-sm disabled:opacity-60"
                      />
                    </td>
                    <td className="py-2 px-4 text-right">
                      <input
                        disabled={!canEditValues}
                        type="number"
                        value={actual ?? ""}
                        onChange={(e) => setField(m.key, "actual", e.target.value)}
                        className="w-32 rounded-md border border-border px-2 py-1 text-right text-sm disabled:opacity-60"
                      />
                      {m.autoSource && <span className="block text-[10px] text-muted mt-0.5">live-sourced, editable</span>}
                    </td>
                    <td className="py-2 px-4 text-center">
                      {pct !== null && pct !== undefined ? (
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_CLASS[vsTargetTier(pct)]}`}>{(pct * 100).toFixed(0)}%</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {(canEditValues || canReview) && (
        <div className="flex items-center gap-3 sticky bottom-4">
          <button
            disabled={saving}
            onClick={save}
            className="rounded-full bg-gradient-to-r from-[var(--pine-700,#155b4a)] to-[var(--pine-500,#24754f)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {savedAt && <span className="text-xs text-emerald-600">Saved ✓</span>}
        </div>
      )}
    </div>
  );
}
