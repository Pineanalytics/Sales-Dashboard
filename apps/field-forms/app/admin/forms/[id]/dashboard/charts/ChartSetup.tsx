"use client";

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);
ChartJS.defaults.font.family = "'Segoe UI', Arial, sans-serif";
ChartJS.defaults.font.size = 12;

// Palette lifted from the reference dashboard mockup.
export const DASH_COLORS = {
  navy: "#1F3864",
  blue: "#2E75B6",
  lightblue: "#EAF1FB",
  green: "#2E7D32",
  amber: "#C55A11",
  red: "#C00000",
  grey: "#F4F6F8",
  border: "#E2E6EC",
  text: "#22293B",
  dark: "#3B3B58",
  muted: "#8a92a6",
};

export const DASH_PALETTE = [
  "#2E75B6",
  "#1F3864",
  "#2E7D32",
  "#C55A11",
  "#C00000",
  "#7C4DFF",
  "#00897B",
  "#8D6E63",
];
