"use client";

import { useMemo, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { ExecutiveSection } from "./universeAnalysis/ExecutiveSection";
import { DuplicatesSection, QualitySection, TargetsSection } from "./universeAnalysis/ListsSections";
import { OpportunitiesSection } from "./universeAnalysis/OpportunitiesSection";
import { ScorecardsSection } from "./universeAnalysis/ScorecardsSection";
import { StrikeSection } from "./universeAnalysis/StrikeSection";
import { UniverseSection } from "./universeAnalysis/UniverseSection";
import { useSection, type AnalysisMeta } from "./universeAnalysis/shared";

type SectionKey = "executive" | "strike" | "universe" | "scorecards" | "opportunities" | "targets" | "duplicates" | "quality";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "executive", label: "Executive diagnosis" },
  { key: "strike", label: "Strike rate" },
  { key: "universe", label: "Universe & coverage" },
  { key: "scorecards", label: "Scorecards" },
  { key: "opportunities", label: "Opportunity sizing" },
  { key: "targets", label: "Target lists" },
  { key: "duplicates", label: "Duplicate outlets" },
  { key: "quality", label: "Data quality" },
];

const FILTERS: { key: string; label: string }[] = [
  { key: "principal", label: "Principal" },
  { key: "route_class", label: "Direct / distributor" },
  { key: "channel", label: "Channel" },
  { key: "region", label: "Region" },
  { key: "segment", label: "Segment" },
  { key: "team_leader", label: "Team leader" },
];

interface FilterOptions {
  meta: AnalysisMeta;
  options: Record<string, string[]>;
}

const ROUTE_LABELS: Record<string, string> = { "Primary Sales": "Direct (Primary Sales)", "Secondary Sales": "Distributor (Secondary Sales)" };

/**
 * Universe analysis: the Active Outlets universe de-duplicated to unique shops and analysed for strike rate, reach, scorecards and opportunities.
 * It reads the same outlet query as the Active Outlets extract; strike rate is for one calendar month, never the year to date.
 */
export function UniverseAnalysisView() {
  const [section, setSection] = useState<SectionKey>("executive");
  const [month, setMonth] = useState<number | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (month !== null) params.set("month", String(month));
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return params.toString();
  }, [month, filters]);

  // The filter options (and the available months) come from an unfiltered request for the same month.
  const optionsQuery = month === null ? "" : `month=${month}`;
  const { data: optionData, status } = useSection<FilterOptions>("filters", optionsQuery);
  const meta = optionData?.meta;
  const selectClass = "rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground";

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        title="Universe analysis"
        action={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {meta ? <span>Built {new Date(meta.builtAt).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span> : null}
            <a href={`/api/universe-analysis?section=outlets&format=csv&limit=200000&${query}`} className="rounded-full border border-border px-3 py-1.5 font-semibold text-primary-blue hover:bg-accent-blue-soft">
              Outlet data (CSV)
            </a>
            <a href={`/api/universe-analysis/export?${query}`} className="rounded-full border border-border px-3 py-1.5 font-semibold text-primary-blue hover:bg-accent-blue-soft">
              Download Excel
            </a>
          </div>
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-muted">
          The active outlet universe (outlets that bought in the last 90 days), reduced to unique shops, and analysed for how well calls convert, how far Pinefrost reaches, and where the next revenue is. It is built from the same query as the Active Outlets extract. Strike rate is for the month chosen, not the year to date.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Month
            <select className={selectClass} value={meta ? meta.month.monthIndex : ""} onChange={(e) => setMonth(Number(e.target.value))} disabled={!meta}>
              {meta ? meta.availableMonths.map((m) => <option key={m.monthIndex} value={m.monthIndex}>{m.label}</option>) : <option>Loading…</option>}
            </select>
          </label>
          {FILTERS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1 text-xs font-semibold text-muted">
              {f.label}
              <select className={selectClass} value={filters[f.key] ?? ""} onChange={(e) => setFilters((current) => ({ ...current, [f.key]: e.target.value }))} disabled={!optionData}>
                <option value="">All</option>
                {(optionData?.options[f.key] ?? []).map((v) => <option key={v} value={v}>{f.key === "route_class" ? (ROUTE_LABELS[v] ?? v) : v}</option>)}
              </select>
            </label>
          ))}
          {Object.values(filters).some(Boolean) ? (
            <button onClick={() => setFilters({})} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">Clear filters</button>
          ) : null}
        </div>
        {status === "error" ? <p className="mt-3 text-xs text-muted">Couldn&apos;t load the filter options; the analysis below may still load.</p> : null}
      </SectionCard>

      <div className="flex flex-wrap gap-1 rounded-2xl bg-background-elevated p-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            aria-pressed={section === s.key}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${section === s.key ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted hover:text-primary-blue"}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "executive" ? <ExecutiveSection query={query} /> : null}
      {section === "strike" ? <StrikeSection query={query} /> : null}
      {section === "universe" ? <UniverseSection query={query} /> : null}
      {section === "scorecards" ? <ScorecardsSection query={query} /> : null}
      {section === "opportunities" ? <OpportunitiesSection query={query} /> : null}
      {section === "targets" ? <TargetsSection query={query} /> : null}
      {section === "duplicates" ? <DuplicatesSection query={query} /> : null}
      {section === "quality" ? <QualitySection query={query} /> : null}
    </div>
  );
}
