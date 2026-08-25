// Order 360 follows the supplied Fulfillment Control Tower reference: deep navy
// surfaces, teal workflow accents, and reserved green/amber/red status colors.
export const O360 = {
  base: "#0B1220",
  panel: "#121A2B",
  panelSoft: "#172339",
  border: "border-white/10",
  borderSoft: "border-white/[0.07]",
  text: "text-white/90",
  textMuted: "text-white/55",
  textFaint: "text-white/35",
  accent: "#3FD8C2",
  gold: "#F2B84B",
  good: "#4ADE80",
  warn: "#FBBF24",
  bad: "#FB6A6A",
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
