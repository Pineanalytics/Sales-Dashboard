import type { CSSProperties } from "react";

// Shared chart system: pine carries the primary series, leaf green marks emphasis,
// and the remaining hues stay restrained enough for dense operational charts.
export const CHART_COLORS = [
  "#0b3d35", // Pine — primary
  "#24754f", // Forest
  "#71b741", // Leaf — emphasis
  "#2f7e78", // Teal
  "#b2863f", // Muted gold
  "#526962", // Charcoal sage
  "#8daa77", // Olive
  "#71817b", // Neutral/target
  "#c16d4f", // Rust — negative variance
  "#b8c9b4", // Pale sage
];

export const CHART_GRID_COLOR = "#d8e3d6";
export const CHART_AXIS_COLOR = "#64756e";

export const tooltipContentStyle: CSSProperties = {
  background: "#ffffff",
  border: "none",
  borderRadius: 10,
  fontSize: 12,
  color: "#123f37",
  boxShadow: "0 8px 20px rgba(11,61,53,0.16)",
};

export const tooltipLabelStyle: CSSProperties = { color: "#3d554d", marginBottom: 4, fontWeight: 600 };
