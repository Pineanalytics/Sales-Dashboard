"use client";

/** Small two-option segmented toggle — shared by any panel whose entire
 *  content genuinely splits into exactly two mutually-exclusive views (no
 *  meaningful "combined" state), e.g. Field & Rep Behavior and Commercial
 *  Performance's Coverage panel switching between Primary/Secondary sales
 *  role. See components/ui/RoleToggle.tsx for the All/Primary/Secondary
 *  variant used where a blended view is still meaningful. */
export function BinaryToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly [{ value: T; label: string }, { value: T; label: string }];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex gap-1 rounded-full bg-background-elevated p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-300 ${
            value === opt.value ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow" : "text-muted-strong hover:text-primary-blue"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
