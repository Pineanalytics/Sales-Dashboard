// Shared recharts styling — Pinefrost Limited corporate palette (blue/cyan/gold/orange,
// no red or purple anywhere in charts).
import type { CSSProperties } from "react";

export const CHART_COLORS = [
  "#153d9a", // Royal Blue — primary
  "#25d8ff", // Cyan Accent — secondary
  "#0e63e7", // Corporate Blue
  "#fdb515", // Gold — forecast
  "#f7931e", // Orange — negative variance
  "#0a1f52", // Primary Navy
  "#7db8ff", // light blue tint (extra categorical slot)
  "#8a94ae", // slate-blue grey — targets/neutral
  "#5c9dfd", // mid blue tint
  "#ffd066", // light gold tint
];

export const CHART_GRID_COLOR = "#dde5f2";
export const CHART_AXIS_COLOR = "#5c6b8a";

export const tooltipContentStyle: CSSProperties = {
  background: "#ffffff",
  border: "none",
  borderRadius: 10,
  fontSize: 12,
  color: "#10193a",
  boxShadow: "0 8px 20px rgba(10,31,82,0.16)",
};

export const tooltipLabelStyle: CSSProperties = { color: "#33415c", marginBottom: 4, fontWeight: 600 };
