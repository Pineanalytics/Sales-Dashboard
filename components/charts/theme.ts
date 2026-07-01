// Shared recharts styling so every chart matches the light Fluent-inspired dashboard theme.
import type { CSSProperties } from "react";

export const CHART_COLORS = [
  "#2895e3", // accent blue
  "#005faf", // secondary blue
  "#5c2d91", // purple
  "#00b050", // green
  "#ffc000", // amber
  "#ff0000", // red
  "#8a8886", // grey
  "#08245e", // dark navy
  "#0a2a8a", // primary blue
  "#21698f", // button blue
];

export const CHART_GRID_COLOR = "#e4e8ef";
export const CHART_AXIS_COLOR = "#6b7280";

export const tooltipContentStyle: CSSProperties = {
  background: "#ffffff",
  border: "none",
  borderRadius: 10,
  fontSize: 12,
  color: "#1a1a1a",
  boxShadow: "0 8px 20px rgba(0,0,0,0.14)",
};

export const tooltipLabelStyle: CSSProperties = { color: "#495057", marginBottom: 4, fontWeight: 600 };
