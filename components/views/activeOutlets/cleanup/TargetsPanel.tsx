"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";

interface Payload {
  period: string;
  defaultPct: number;
  overrides: { teamLeader: string; targetPct: number }[];
  teamLeaders: string[];
}

const inputClass = "rounded-full border border-border bg-background-elevated px-4 py-1.5 text-xs outline-none focus:border-primary-blue";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";
const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";

/** Admin: the share of outlets every team leader must have reviewed by the end of a month, and any team leader's own target. */
export function TargetsPanel({ onChanged }: { onChanged: () => void }) {
  const [period, setPeriod] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).slice(0, 7));
  const [data, setData] = useState<Payload | null>(null);
  const [defaultInput, setDefaultInput] = useState("");
  const [leader, setLeader] = useState("");
  const [leaderPct, setLeaderPct] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outlet-cleanup/targets?period=${encodeURIComponent(period)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load the targets.");
        if (!cancelled) {
          setData(body);
          setDefaultInput(String(body.defaultPct));
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setMessage({ tone: "error", text: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [period, reload]);

  const save = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/outlet-cleanup/targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period, ...body }) });
      const result = await response.json();
      if (!response.ok) setMessage({ tone: "error", text: result.error ?? "Failed to save." });
      else {
        setMessage({ tone: "ok", text: success });
        setReload((t) => t + 1);
        onChanged();
      }
    } catch {
      setMessage({ tone: "error", text: "The target could not be saved. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Cleanup targets">
      <p className="text-sm text-muted-strong">The share of their outlets each team leader must have reviewed by the end of the month. Teams are ranked on how much of this they have reached. Progress is cumulative, so a rising target (40% in November, 100% in December) works.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Month</span>
          <input type="month" className={inputClass} value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Target for everyone (%)</span>
          <input type="number" min={1} max={100} className={`${inputClass} w-28`} value={defaultInput} onChange={(e) => setDefaultInput(e.target.value)} />
        </label>
        <button className={primaryButton} disabled={busy || defaultInput === ""} onClick={() => save({ teamLeader: "*", targetPct: Number(defaultInput) }, "Target saved for everyone.")}>Save</button>
      </div>

      <h4 className="mt-6 text-sm font-bold text-primary-blue">Team leaders with their own target</h4>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <select aria-label="Team leader" className={inputClass} value={leader} onChange={(e) => setLeader(e.target.value)}>
          <option value="">Team leader…</option>
          {(data?.teamLeaders ?? []).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input type="number" min={1} max={100} placeholder="%" aria-label="Target %" className={`${inputClass} w-24`} value={leaderPct} onChange={(e) => setLeaderPct(e.target.value)} />
        <button className={primaryButton} disabled={busy || leader === "" || leaderPct === ""} onClick={() => save({ teamLeader: leader, targetPct: Number(leaderPct) }, `Target saved for ${leader}.`)}>Set</button>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm text-muted-strong">
        {(data?.overrides ?? []).map((o) => (
          <li key={o.teamLeader} className="flex items-center gap-3">
            <span>{o.teamLeader}: {o.targetPct}%</span>
            <button className={ghostButton} disabled={busy} onClick={() => save({ teamLeader: o.teamLeader, clear: true }, `${o.teamLeader} is back on the default.`)}>Use the default</button>
          </li>
        ))}
        {data && data.overrides.length === 0 ? <li className="text-muted">None: everyone has the default.</li> : null}
      </ul>
      {message ? <p role="status" className={`mt-3 text-sm ${message.tone === "ok" ? "text-accent-green" : "text-accent-red"}`}>{message.text}</p> : null}
    </SectionCard>
  );
}
