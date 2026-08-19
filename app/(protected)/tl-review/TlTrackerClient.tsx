"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SectionDefinition, MetricDefinition } from "@/lib/performanceTracker/definitions";
import { vsTargetTier, strikeRateTier, oosRateTier, computeRepScore, type Grade, type RepRowInput } from "@/lib/performanceTracker/scoring";

interface MetricRow {
  metricKey: string;
  target: number | null;
  actual: number | null;
}
interface RepRow extends RepRowInput {
  id: string;
  employeeCode: string | null;
  repName: string;
  territory: string | null;
  channel: string | null;
}
interface TrackerData {
  id: string;
  periodMonth: string;
  reviewedByName: string | null;
  status: string;
  reviewComments: string | null;
  metrics: MetricRow[];
  repRows: RepRow[];
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

const inputCls = "w-28 rounded-md border border-border px-2 py-1 text-right text-sm disabled:opacity-60";

export default function TlTrackerClient({
  teamLeaderId,
  teamLeaderOptions,
  canEditValues,
  canReview,
}: {
  teamLeaderId: string;
  teamLeaderOptions: { id: string; name: string }[] | null;
  canEditValues: boolean;
  canReview: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriod());
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [sections, setSections] = useState<SectionDefinition[]>([]);
  const [tracker, setTracker] = useState<TrackerData | null>(null);
  const [values, setValues] = useState<Map<string, MetricRow>>(new Map());
  const [repRows, setRepRows] = useState<RepRow[]>([]);
  const [reviewedByName, setReviewedByName] = useState("");
  const [trackerStatus, setTrackerStatus] = useState("draft");
  const [reviewComments, setReviewComments] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [addingRep, setAddingRep] = useState(false);
  const [newRepName, setNewRepName] = useState("");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch(`/api/performance-tracker?type=TEAM_LEADER&period=${period}&teamLeaderId=${teamLeaderId}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load.");
        if (cancelled) return;
        setSections(body.sections);
        setTracker(body.tracker);
        setValues(new Map(body.tracker.metrics.map((m: MetricRow) => [m.metricKey, m])));
        setRepRows(body.tracker.repRows ?? []);
        setReviewedByName(body.tracker.reviewedByName ?? "");
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
  }, [period, teamLeaderId]);

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

  async function save() {
    if (!tracker) return;
    setSaving(true);
    const res = await fetch("/api/performance-tracker", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "TEAM_LEADER",
        periodMonth: period,
        teamLeaderId,
        metrics: Array.from(values.values()),
        reviewedByName,
        status: canReview ? trackerStatus : undefined,
        reviewComments: canReview ? reviewComments : undefined,
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 3000);
    }
  }

  async function addRep() {
    if (!tracker || !newRepName.trim()) return;
    setAddingRep(true);
    const res = await fetch("/api/performance-tracker/rep-rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackerId: tracker.id, repName: newRepName.trim() }),
    });
    setAddingRep(false);
    if (res.ok) {
      const { row } = await res.json();
      setRepRows((prev) => [...prev, row]);
      setNewRepName("");
    }
  }

  async function updateRep(id: string, field: keyof RepRow, raw: string) {
    setRepRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: raw === "" ? null : isNumericField(field) ? Number(raw) : raw } : r)));
    await fetch("/api/performance-tracker/rep-rows", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: raw === "" ? null : raw }),
    });
  }

  async function removeRep(id: string) {
    setRepRows((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/performance-tracker/rep-rows?id=${id}`, { method: "DELETE" });
  }

  const repScores = useMemo(() => repRows.map((r) => ({ row: r, score: computeRepScore(r) })), [repRows]);

  if (status === "loading") return <div className="p-8 text-sm text-muted">Loading Team Leader Tracker…</div>;
  if (status === "error" || !tracker) return <div className="p-8 text-sm text-rose-600">Couldn&apos;t load the tracker. Try refreshing.</div>;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600,#1f6a4e)] mb-1">Team Leader</p>
          <h1 className="text-2xl font-semibold">TL Performance Tracker</h1>
          <p className="text-sm text-muted mt-1">Monthly team KPIs, plus a Rep Scorecard with weighted score/grade per rep.</p>
        </div>
        <div className="flex items-end gap-3">
          {teamLeaderOptions ? (
            <label className="flex flex-col gap-1 text-xs text-muted">
              Team Leader
              <select
                value={teamLeaderId}
                onChange={(e) => router.push(`/tl-review?teamLeaderId=${e.target.value}`)}
                className="rounded-md border border-border px-2 py-1.5 text-sm"
              >
                {teamLeaderOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-xs text-muted">
            Period
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="rounded-md border border-border px-2 py-1.5 text-sm" />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Reviewed by
          <input
            disabled={!canEditValues}
            value={reviewedByName}
            onChange={(e) => setReviewedByName(e.target.value)}
            placeholder="Supervisor name"
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
            placeholder="Supervisor notes"
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
                <th className="py-2 px-4 text-center">Achievement %</th>
              </tr>
            </thead>
            <tbody>
              {section.metrics.map((m) => {
                const tierFor = m.key.toLowerCase().includes("strikerate")
                  ? strikeRateTier
                  : m.key.toLowerCase().includes("oosrate")
                    ? oosRateTier
                    : vsTargetTier;
                if (m.computedFrom) {
                  const pct = percentMap.get(m.key);
                  return (
                    <tr key={m.key} className="border-b border-border/40">
                      <td className="py-2 px-4 text-muted-strong">{m.label}</td>
                      <td className="py-2 px-4 text-right text-muted">—</td>
                      <td className="py-2 px-4 text-right font-medium">{pct !== null && pct !== undefined ? formatMetric(pct, "pct") : "—"}</td>
                      <td className="py-2 px-4 text-center">
                        {pct !== null && pct !== undefined ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_CLASS[tierFor(pct)]}`}>{(pct * 100).toFixed(0)}%</span> : "—"}
                      </td>
                    </tr>
                  );
                }
                const target = metricValue(m.key, "target");
                const actual = metricValue(m.key, "actual");
                const pct = percentMap.get(m.key);
                return (
                  <tr key={m.key} className="border-b border-border/40">
                    <td className="py-2 px-4 text-muted-strong">{m.label}</td>
                    <td className="py-2 px-4 text-right">
                      <input disabled={!canEditValues} type="number" value={target ?? ""} onChange={(e) => setField(m.key, "target", e.target.value)} className={inputCls} />
                    </td>
                    <td className="py-2 px-4 text-right">
                      <input disabled={!canEditValues} type="number" value={actual ?? ""} onChange={(e) => setField(m.key, "actual", e.target.value)} className={inputCls} />
                      {m.autoSource && <span className="block text-[10px] text-muted mt-0.5">live-sourced, editable</span>}
                    </td>
                    <td className="py-2 px-4 text-center">
                      {pct !== null && pct !== undefined ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_CLASS[tierFor(pct)]}`}>{(pct * 100).toFixed(0)}%</span> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {(canEditValues || canReview) && (
        <div className="flex items-center gap-3">
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

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="font-medium">Rep Scorecard</span>
          <span className="text-xs text-muted">Weighted score = Revenue 40% + Distribution (LPPC) 30% + Strike Rate 20% + OOS Score 10%</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border/60 whitespace-nowrap">
                <th className="py-2 px-3">Rep Name</th>
                <th className="py-2 px-3">Territory</th>
                <th className="py-2 px-3">Channel</th>
                <th className="py-2 px-3 text-right">Vol Target</th>
                <th className="py-2 px-3 text-right">Vol Actual</th>
                <th className="py-2 px-3 text-right">Rev Target</th>
                <th className="py-2 px-3 text-right">Rev Actual</th>
                <th className="py-2 px-3 text-right">LPPC Target</th>
                <th className="py-2 px-3 text-right">LPPC Actual</th>
                <th className="py-2 px-3 text-right">Calls Planned</th>
                <th className="py-2 px-3 text-right">Calls Made</th>
                <th className="py-2 px-3 text-right">Productive</th>
                <th className="py-2 px-3 text-right">OOS Audited</th>
                <th className="py-2 px-3 text-right">OOS Found</th>
                <th className="py-2 px-3 text-center">Strike Rate</th>
                <th className="py-2 px-3 text-center">Weighted Score</th>
                <th className="py-2 px-3 text-center">Grade</th>
                {canEditValues && <th className="py-2 px-3"></th>}
              </tr>
            </thead>
            <tbody>
              {repScores.map(({ row, score }) => (
                <tr key={row.id} className="border-b border-border/40">
                  <td className="py-1.5 px-3 font-medium">{row.repName}</td>
                  <RepTextCell disabled={!canEditValues} value={row.territory} onSave={(v) => updateRep(row.id, "territory", v)} />
                  <RepTextCell disabled={!canEditValues} value={row.channel} onSave={(v) => updateRep(row.id, "channel", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.volumeTarget} onSave={(v) => updateRep(row.id, "volumeTarget", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.volumeActual} onSave={(v) => updateRep(row.id, "volumeActual", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.revenueTarget} onSave={(v) => updateRep(row.id, "revenueTarget", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.revenueActual} onSave={(v) => updateRep(row.id, "revenueActual", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.lppcTarget} onSave={(v) => updateRep(row.id, "lppcTarget", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.lppcActual} onSave={(v) => updateRep(row.id, "lppcActual", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.callsPlanned} onSave={(v) => updateRep(row.id, "callsPlanned", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.callsMade} onSave={(v) => updateRep(row.id, "callsMade", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.productiveCalls} onSave={(v) => updateRep(row.id, "productiveCalls", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.oosAudited} onSave={(v) => updateRep(row.id, "oosAudited", v)} />
                  <RepNumCell disabled={!canEditValues} value={row.oosInstances} onSave={(v) => updateRep(row.id, "oosInstances", v)} />
                  <td className="py-1.5 px-3 text-center">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${TIER_CLASS[strikeRateTier(score.strikeRatePct)]}`}>{(score.strikeRatePct * 100).toFixed(0)}%</span>
                  </td>
                  <td className="py-1.5 px-3 text-center font-medium">{(score.weightedPct * 100).toFixed(1)}%</td>
                  <td className="py-1.5 px-3 text-center">
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${GRADE_CLASS[score.grade]}`}>{score.grade}</span>
                  </td>
                  {canEditValues && (
                    <td className="py-1.5 px-3">
                      <button onClick={() => removeRep(row.id)} className="text-xs text-rose-600 hover:underline">
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {repScores.length === 0 && (
                <tr>
                  <td colSpan={17} className="py-4 px-3 text-muted">
                    No reps on this scorecard yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canEditValues && (
          <div className="flex items-center gap-2 border-t border-border p-3">
            <input
              value={newRepName}
              onChange={(e) => setNewRepName(e.target.value)}
              placeholder="Rep name"
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            />
            <button disabled={addingRep || !newRepName.trim()} onClick={addRep} className="rounded-md border border-border px-3 py-1.5 text-sm font-medium disabled:opacity-50">
              + Add rep
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function isNumericField(field: keyof RepRow): boolean {
  return !["repName", "territory", "channel", "employeeCode", "id"].includes(field as string);
}

function RepTextCell({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (v: string) => void }) {
  return (
    <td className="py-1.5 px-3">
      <input disabled={disabled} defaultValue={value ?? ""} onBlur={(e) => onSave(e.target.value)} className="w-24 rounded-md border border-border px-2 py-1 text-sm disabled:opacity-60" />
    </td>
  );
}
function RepNumCell({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (v: string) => void }) {
  return (
    <td className="py-1.5 px-3 text-right">
      <input disabled={disabled} type="number" defaultValue={value ?? ""} onBlur={(e) => onSave(e.target.value)} className="w-24 rounded-md border border-border px-2 py-1 text-right text-sm disabled:opacity-60" />
    </td>
  );
}
