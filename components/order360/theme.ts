// Order 360's own dark surface, blended from the reference dashboard's palette
// (--bg-base:#0B1220, --bg-panel:#121A2B, --accent:#3FD8C2) and this app's own
// Pinefrost brand tokens (--brand-navy:#0a1f52, --brand-orange:#f7931e,
// --accent-blue:#25d8ff — see app/globals.css) rather than either verbatim.
// Scoped to this one module, the same way DashboardHero.tsx drops a dark navy
// panel into an otherwise light page.
export const O360 = {
  base: "#0a0f1f", // between brand-navy and the reference's near-black base
  panel: "#111a33", // card surface
  panelSoft: "#0e1730",
  border: "border-white/10",
  borderSoft: "border-white/[0.07]",
  text: "text-white/90",
  textMuted: "text-white/55",
  textFaint: "text-white/35",
  accent: "#25d8ff", // this app's accent-blue, standing in for the reference's teal
  gold: "#f7931e", // brand-orange, standing in for the reference's gold
  good: "#34d399", // emerald-400
  warn: "#fbbf24", // amber-400
  bad: "#fb7185", // rose-400
} as const;

export function ageClass(age: number): "good" | "warn" | "bad" {
  if (age > 7) return "bad";
  if (age >= 3) return "warn";
  return "good";
}

export const AGE_COLOR: Record<"good" | "warn" | "bad", string> = {
  good: O360.good,
  warn: O360.warn,
  bad: O360.bad,
};

export function fmtKES(n: number, compact = false): string {
  const v = Number(n) || 0;
  if (compact) {
    if (Math.abs(v) >= 1_000_000) return `KES ${(v / 1_000_000).toFixed(2)}M`;
    if (Math.abs(v) >= 1_000) return `KES ${(v / 1_000).toFixed(1)}K`;
    return `KES ${v.toFixed(0)}`;
  }
  return `KES ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function fmtNum(n: number): string {
  return Number(n).toLocaleString("en-US");
}
