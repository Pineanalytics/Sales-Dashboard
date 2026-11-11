"use client";

import { useEffect, useRef } from "react";
import { ALL_PAGE_KEYS, REPORT_MODULES, isBaselinePage, toggleReports, type PageKey, type ReportModule } from "@/lib/pageAccess";

/** A checkbox that can also show "some but not all" (the native indeterminate state, which has no HTML attribute). */
function TriCheckbox({ checked, partial, disabled, label, onToggle }: { checked: boolean; partial: boolean; disabled?: boolean; label: string; onToggle: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial && !checked;
  }, [partial, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      className="h-4 w-4 shrink-0 rounded border-border text-primary-blue focus:ring-secondary-blue disabled:opacity-60"
    />
  );
}

/** The reports a login sees, grouped as the sidebar groups them: tick a whole module, or open it up and pick its reports one by
 *  one; "All modules" ticks everything, after which any report can still be unticked. Submits one hidden "pages" input per
 *  ticked report (plus "pagesSubmitted", so the save knows the picker was on the form). */
export function ModuleAccessPicker({ role, selected, onChange }: { role: string; selected: ReadonlySet<PageKey>; onChange: (next: Set<PageKey>) => void }) {
  const locked = (key: PageKey) => isBaselinePage(key, role);
  const isOn = (key: PageKey) => locked(key) || selected.has(key);
  const editable = ALL_PAGE_KEYS.filter((key) => !locked(key));
  const allOn = editable.every((key) => selected.has(key));
  const someOn = editable.some((key) => selected.has(key));
  const reportsOn = ALL_PAGE_KEYS.filter(isOn).length;
  const modulesOn = REPORT_MODULES.filter((module) => module.reports.some((report) => isOn(report.key))).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
          <TriCheckbox checked={allOn} partial={someOn} label="All modules" onToggle={() => onChange(toggleReports(selected, editable, !allOn))} />
          All modules
        </label>
        <span className="text-xs text-muted">
          {modulesOn} of {REPORT_MODULES.length} modules · {reportsOn} of {ALL_PAGE_KEYS.length} reports
        </span>
      </div>

      <div className="columns-1 gap-2 sm:columns-2 xl:columns-3 2xl:columns-4">
        {REPORT_MODULES.map((module) => (
          <ModuleCard key={module.id} module={module} isOn={isOn} locked={locked} onToggle={(keys, on) => onChange(toggleReports(selected, keys, on))} />
        ))}
      </div>

      <input type="hidden" name="pagesSubmitted" value="1" />
      {[...selected].map((key) => (
        <input key={key} type="hidden" name="pages" value={key} />
      ))}
    </div>
  );
}

function ModuleCard({
  module,
  isOn,
  locked,
  onToggle,
}: {
  module: ReportModule;
  isOn: (key: PageKey) => boolean;
  locked: (key: PageKey) => boolean;
  onToggle: (keys: PageKey[], on: boolean) => void;
}) {
  const editableKeys = module.reports.map((report) => report.key).filter((key) => !locked(key));
  const onCount = module.reports.filter((report) => isOn(report.key)).length;
  const full = onCount === module.reports.length;
  const single = module.reports.length === 1;
  const alwaysOn = editableKeys.length === 0;

  return (
    <div className={`mb-2 break-inside-avoid rounded-xl border px-3 py-2 transition-colors ${onCount > 0 ? "border-secondary-blue/40 bg-accent-blue-soft/50" : "border-border bg-surface"}`}>
      <label className={`flex items-center gap-2 ${alwaysOn ? "" : "cursor-pointer"}`}>
        <TriCheckbox checked={full} partial={onCount > 0} disabled={alwaysOn} label={module.label} onToggle={() => onToggle(editableKeys, !full)} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{module.label}</span>
        {alwaysOn ? (
          <span className="shrink-0 rounded-full bg-accent-green-soft px-2 py-0.5 text-[10px] font-semibold text-accent-green">Always on</span>
        ) : !single ? (
          <span className="shrink-0 text-[11px] font-medium text-muted">
            {onCount}/{module.reports.length}
          </span>
        ) : null}
      </label>
      {!single ? (
        <div className="mt-1.5 flex flex-col gap-1 border-t border-border/50 pl-6 pt-1.5">
          {module.reports.map((report) => (
            <label key={report.key} className="flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={isOn(report.key)}
                disabled={locked(report.key)}
                onChange={(event) => onToggle([report.key], event.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-border text-primary-blue focus:ring-secondary-blue"
              />
              <span className="min-w-0">
                <span className="text-muted-strong">{report.label}</span>
                {report.detail ? <span className="block text-[10px] leading-tight text-muted">{report.detail}</span> : null}
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
