"use client";

import type { OutletFilterOptions, OutletFilters, OutletStatus, OutletView } from "@/lib/outletUniverse/query";
import { OUTLET_SOURCES, OUTLET_SOURCE_LABELS } from "@/lib/outletUniverse/normalize";

const selectClass = "max-w-[190px] bg-transparent text-xs font-semibold text-muted-strong outline-none";
const pillClass = "flex items-center rounded-full border border-border bg-background-elevated px-3 py-1.5";
const labelClass = "text-[10px] font-semibold uppercase tracking-wide text-muted";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <div className={pillClass}>{children}</div>
    </label>
  );
}

function ValueSelect({ label, value, values, onChange }: { label: string; value: string | null; values: string[]; onChange: (value: string | null) => void }) {
  return (
    <Field label={label}>
      <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={selectClass}>
        <option value="">All</option>
        {values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Territory and Rep have hundreds of values, so they are type-to-find. */
function ComboField({ label, value, values, listId, onChange }: { label: string; value: string | null; values: string[]; listId: string; onChange: (value: string | null) => void }) {
  return (
    <Field label={label}>
      <input
        aria-label={label}
        list={listId}
        value={value ?? ""}
        placeholder="All"
        onChange={(event) => {
          const next = event.target.value;
          // Only an exact known value filters; a half-typed one waits.
          if (next === "") onChange(null);
          else if (values.includes(next)) onChange(next);
        }}
        className="w-[150px] bg-transparent text-xs font-semibold text-muted-strong outline-none placeholder:font-normal"
      />
      <datalist id={listId}>
        {values.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
    </Field>
  );
}

const VIEWS: { value: OutletView; label: string; hint: string }[] = [
  { value: "principal", label: "Active Outlet by Principal", hint: "An outlet is counted under each principal it buys." },
  { value: "general", label: "Active Outlet – General", hint: "Every outlet counted once, however many principals it buys." },
];

export function FilterBar({
  filters,
  options,
  onChange,
  onReset,
  searchText,
  onSearchText,
}: {
  filters: OutletFilters;
  options: OutletFilterOptions | null;
  onChange: (patch: Partial<OutletFilters>) => void;
  onReset: () => void;
  searchText: string;
  onSearchText: (value: string) => void;
}) {
  const hasFilter = Boolean(filters.role || filters.source || filters.principal || filters.channel || filters.segment || filters.region || filters.territory || filters.route || filters.rep || filters.q || filters.status !== "active");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 rounded-full bg-background-elevated p-0.5" role="tablist" aria-label="Active Outlet view">
          {VIEWS.map((view) => (
            <button
              key={view.value}
              role="tab"
              aria-selected={filters.view === view.value}
              title={view.hint}
              onClick={() => onChange({ view: view.value })}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-300 ${
                filters.view === view.value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"
              }`}
            >
              {view.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">{VIEWS.find((view) => view.value === filters.view)?.hint}</span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Source">
          <select aria-label="Source" value={filters.source ?? ""} onChange={(event) => onChange({ source: (event.target.value || null) as OutletFilters["source"] })} className={selectClass}>
            <option value="">All sources</option>
            {OUTLET_SOURCES.map((source) => (
              <option key={source} value={source}>
                {OUTLET_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sales Role">
          <select aria-label="Sales Role" value={filters.role ?? ""} onChange={(event) => onChange({ role: (event.target.value || null) as OutletFilters["role"] })} className={selectClass}>
            <option value="">Primary + Secondary (split)</option>
            <option value="Primary Sales">Primary Sales only</option>
            <option value="Secondary Sales">Secondary Sales only</option>
          </select>
        </Field>
        <ValueSelect label="Principal" value={filters.principal} values={options?.principals ?? []} onChange={(principal) => onChange({ principal })} />
        <ValueSelect label="Channel" value={filters.channel} values={options?.channels ?? []} onChange={(channel) => onChange({ channel })} />
        <ValueSelect label="Segment / Type" value={filters.segment} values={options?.segments ?? []} onChange={(segment) => onChange({ segment })} />
        <ValueSelect label="Region" value={filters.region} values={options?.regions ?? []} onChange={(region) => onChange({ region })} />
        <ComboField label="Territory" value={filters.territory} values={options?.territories ?? []} listId="outlet-territories" onChange={(territory) => onChange({ territory })} />
        <ComboField label="Route" value={filters.route} values={options?.routes ?? []} listId="outlet-routes" onChange={(route) => onChange({ route })} />
        <ComboField label="Rep" value={filters.rep} values={options?.reps ?? []} listId="outlet-reps" onChange={(rep) => onChange({ rep })} />
        <Field label="Status">
          <select aria-label="Status" value={filters.status} onChange={(event) => onChange({ status: event.target.value as OutletStatus })} className={selectClass}>
            <option value="active">Active (bought ≤ 60 days)</option>
            <option value="inactive">Inactive</option>
            <option value="all">Active + inactive</option>
          </select>
        </Field>
        <Field label="Find outlet">
          <input aria-label="Find outlet" value={searchText} onChange={(event) => onSearchText(event.target.value)} placeholder="Name or ID" className="w-[150px] bg-transparent text-xs font-semibold text-muted-strong outline-none placeholder:font-normal" />
        </Field>
        {hasFilter ? (
          <button onClick={onReset} className="rounded-full px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
            Reset filters
          </button>
        ) : null}
      </div>
    </div>
  );
}
