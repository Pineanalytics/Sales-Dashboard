"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { WEEKDAYS, type OutletDetail, type Weekday } from "@/lib/outletCleanup/types";
import { RouteBuilder } from "./RouteBuilder";

const inputClass = "w-full rounded-lg border border-border bg-background-elevated px-3 py-2 text-sm text-muted-strong outline-none focus:border-primary-blue disabled:cursor-not-allowed disabled:opacity-60";
const primaryButton = "rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-1.5 text-xs font-semibold text-white hover:shadow-cyan-glow disabled:opacity-50";
const ghostButton = "rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft disabled:opacity-50";

export interface RepRoutePayload {
  principal: string;
  action: "CONFIRM" | "CHANGE";
  repCode?: string;
  routeName?: string;
  visitDays: Weekday[];
}

/** One principal of the outlet: the rep who visits it, the route they visit it on and the days of the week. The visit history suggests the days and the rep; the team leader validates or changes them. */
export function RepRouteRow({ detail, row, disabled, error, onSave }: { detail: OutletDetail; row: OutletDetail["reps"][number]; disabled: boolean; error?: string; onSave: (payload: RepRoutePayload) => Promise<boolean> }) {
  const decision = detail.repDecisions.find((d) => d.principal.toLowerCase() === row.principal.toLowerCase());
  const routing = detail.routing[row.principal];
  const repOptions = detail.repOptions[row.principal] ?? [];
  const suggestion = routing?.suggestion;

  const [repChoice, setRepChoice] = useState("");
  const [routeName, setRouteName] = useState(routing?.routeName ?? "");
  const [days, setDays] = useState<Weekday[]>(routing?.visitDays ?? []);
  const [extraRoutes, setExtraRoutes] = useState<string[]>([]);
  const [naming, setNaming] = useState(false);

  const settled = Boolean(decision) && !detail.canUnlock;
  const off = disabled || !row.editable || settled;
  const routeOptions = [...new Set([...(routing?.routeOptions ?? []), ...extraRoutes, ...(routeName ? [routeName] : [])])].sort((a, b) => a.localeCompare(b));
  const currentRep = decision ? decision.rep : row.rep;
  const canSave = !off && (repChoice !== "" || Boolean(row.rep)) && routeName !== "" && days.length > 0;
  const toggleDay = (day: Weekday) => setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : WEEKDAYS.filter((d) => d === day || current.includes(d))));

  const useSuggestion = () => {
    if (suggestion && suggestion.suggestedDays.length > 0) setDays(suggestion.suggestedDays);
    else if (suggestion?.planned && suggestion.planned.days.length > 0) setDays(suggestion.planned.days);
  };
  const planned = suggestion?.planned;
  const hasDaySuggestion = Boolean(suggestion && (suggestion.suggestedDays.length > 0 || (planned && planned.days.length > 0)));

  return (
    <div className="rounded-lg border border-border px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <span className="font-semibold text-brand-navy">{row.principal}</span>
          <span className="ml-2 text-muted-strong">{currentRep ?? "No rep on record"}</span>
          {row.teamLeader ? <span className="ml-2 text-xs text-muted">TL {row.teamLeader}</span> : null}
          {!row.editable ? <span className="ml-2 text-xs text-muted">Not on your team</span> : null}
        </div>
        {decision ? <Badge tier="good">{decision.action === "CHANGED" ? `Rep changed from ${decision.previousRep ?? "none"}` : "Validated ✓"}</Badge> : null}
      </div>

      {suggestion ? (
        <div className="mt-2 rounded-lg bg-accent-blue-soft/50 px-3 py-2 text-xs text-muted-strong">
          {suggestion.visitDays > 0 ? (
            <p>
              <strong>Suggested from {suggestion.basis}:</strong> visited {suggestion.visitDays} day{suggestion.visitDays === 1 ? "" : "s"} in the last {suggestion.windowDays} (about {suggestion.visitsPerMonth} a month, {suggestion.cadence.toLowerCase()}).
              {" "}
              {WEEKDAYS.filter((d) => suggestion.weekdayCounts[d] > 0).map((d) => `${d} ${suggestion.weekdayCounts[d]}`).join(" · ")}
              {suggestion.suggestedDays.length > 0 ? <> → suggested day{suggestion.suggestedDays.length === 1 ? "" : "s"}: <strong>{suggestion.suggestedDays.join(", ")}</strong></> : " → no regular day stands out"}.
            </p>
          ) : (
            <p><strong>No visits on record</strong> in the last {suggestion.windowDays} days ({suggestion.basis}).</p>
          )}
          {suggestion.reps.length > 0 ? <p className="mt-1">Visited by {suggestion.reps.slice(0, 3).map((r) => `${r.name} (${r.visits})`).join(", ")}.</p> : null}
          {planned ? <p className="mt-1">The source system plans {planned.route ? <>route <strong>{planned.route}</strong></> : "this outlet"}{planned.days.length > 0 ? <> on <strong>{planned.days.join(", ")}</strong></> : null}.</p> : null}
          {!off && (hasDaySuggestion || suggestion.suggestedRep) ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {hasDaySuggestion ? <button type="button" className={ghostButton} onClick={useSuggestion}>Use the suggested days</button> : null}
              {suggestion.suggestedRep ? <button type="button" className={ghostButton} onClick={() => setRepChoice(suggestion.suggestedRep!.code)}>Use {suggestion.suggestedRep.name} as the visiting rep</button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Visiting rep</span>
          <select aria-label={`Rep for ${row.principal}`} className={inputClass} disabled={off} value={repChoice} onChange={(e) => setRepChoice(e.target.value)}>
            <option value="">{row.rep ? `${row.rep} (keep)` : "Choose a rep…"}</option>
            {repOptions.filter((o) => o.name !== row.rep).map((o) => <option key={o.code} value={o.code}>{o.name}{o.teamLeader ? ` (${o.teamLeader})` : ""}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
            Route
            {!off && row.teamLeader ? <button type="button" onClick={() => setNaming(!naming)} className="text-xs font-semibold normal-case text-primary-blue hover:underline">{naming ? "Cancel" : "Name a new route"}</button> : null}
          </span>
          <select aria-label={`Route for ${row.principal}`} className={inputClass} disabled={off} value={routeName} onChange={(e) => setRouteName(e.target.value)}>
            <option value="">Choose a route…</option>
            {routeOptions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      {naming && row.teamLeader ? (
        <RouteBuilder
          teamLeader={row.teamLeader}
          locations={detail.routeLocations}
          onCreated={(name) => {
            setExtraRoutes((current) => [...current, name]);
            setRouteName(name);
            setNaming(false);
          }}
          onCancel={() => setNaming(false)}
        />
      ) : null}

      <div className="mt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Visit days</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {WEEKDAYS.map((d) => (
            <button key={d} type="button" disabled={off} aria-pressed={days.includes(d)} onClick={() => toggleDay(d)} className={`w-12 rounded-full border px-2 py-1 text-xs font-semibold disabled:opacity-60 ${days.includes(d) ? "border-primary-blue bg-primary-blue text-white" : "border-border text-muted-strong hover:bg-accent-blue-soft"}`}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryButton}
          disabled={!canSave}
          onClick={() => onSave({ principal: row.principal, action: repChoice === "" ? "CONFIRM" : "CHANGE", repCode: repChoice || undefined, routeName, visitDays: days })}
        >
          {repChoice === "" ? "Validate rep, route and days" : "Assign rep, route and days"}
        </button>
        {settled ? <span className="text-xs text-muted">Locked: ask your supervisor or an admin to reopen it.</span> : null}
        {!off && !canSave ? <span className="text-xs text-muted">Choose the route and at least one day to save.</span> : null}
      </div>
      {error ? <p className="mt-2 text-xs text-accent-red">{error}</p> : null}
    </div>
  );
}
