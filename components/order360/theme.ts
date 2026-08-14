// Order 360 keeps a distinct dark workspace while using the same pine and leaf-green
// visual language as the rest of Pinefrost Analytics.
export const O360 = {
  base: "#071f1b",
  panel: "#0d312a",
  panelSoft: "#0a2923",
  border: "border-white/10",
  borderSoft: "border-white/[0.07]",
  text: "text-white/90",
  textMuted: "text-white/55",
  textFaint: "text-white/35",
  accent: "#71b741",
  gold: "#c29a42",
  good: "#58b875",
  warn: "#e0b355",
  bad: "#dc7a61",
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
