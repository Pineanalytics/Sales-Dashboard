"use client";

import type { RoleCategory } from "@/lib/timeIntelligence";

const OPTIONS: { value: Extract<RoleCategory, "primary" | "secondary">; label: string }[] = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
];

/** Compact role control used wherever an executive coverage summary is shown.
 * It deliberately excludes "All" so each card always reflects one source
 * SalesRole rather than mixing Primary and Secondary totals. */
export function CoverageRoleToggle({ value, onChange }: { value: Extract<RoleCategory, "primary" | "secondary">; onChange: (value: Extract<RoleCategory, "primary" | "secondary">) => void }) {
  return (
    <div className="inline-flex rounded-full bg-background-elevated p-0.5" aria-label="Coverage sales role">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            value === option.value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
