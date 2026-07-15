"use client";

export type RoleFilter = "all" | "Primary Sales" | "Secondary Sales";

const OPTIONS: { key: RoleFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Primary Sales", label: "Primary" },
  { key: "Secondary Sales", label: "Secondary" },
];

/** All/Primary/Secondary segmented toggle, shared across Active Outlets,
 *  Timestamps, and JP Adherence — each of which previously showed both
 *  roles simultaneously with no way to narrow to just one. */
export function RoleToggle({ value, onChange }: { value: RoleFilter; onChange: (value: RoleFilter) => void }) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-background-elevated p-1">
      {OPTIONS.map((opt) => (
        <button
          key={opt.key}
          onClick={() => onChange(opt.key)}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 ${
            value === opt.key ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
