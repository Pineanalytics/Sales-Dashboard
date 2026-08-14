"use client";

import "./ChartSetup";
import { Bar } from "react-chartjs-2";

export function BarChart({
  labels,
  values,
  label,
  color,
  horizontal = false,
  suffix = "",
}: {
  labels: string[];
  values: number[];
  label: string;
  color: string;
  horizontal?: boolean;
  suffix?: string;
}) {
  return (
    <Bar
      data={{
        labels,
        datasets: [
          {
            label,
            data: values,
            backgroundColor: color,
            borderRadius: 5,
            maxBarThickness: 38,
          },
        ],
      }}
      options={{
        indexAxis: horizontal ? "y" : "x",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.formattedValue}${suffix}`,
            },
          },
        },
        scales: {
          y: horizontal
            ? { grid: { display: false } }
            : { beginAtZero: true, grid: { color: "#EEF1F5" } },
          x: horizontal
            ? { beginAtZero: true, grid: { color: "#EEF1F5" } }
            : { grid: { display: false } },
        },
      }}
    />
  );
}
