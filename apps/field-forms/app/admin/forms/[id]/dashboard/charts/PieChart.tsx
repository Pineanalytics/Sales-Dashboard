"use client";

import "./ChartSetup";
import { Doughnut } from "react-chartjs-2";

export function PieChart({
  labels,
  values,
  colors,
}: {
  labels: string[];
  values: number[];
  colors: string[];
}) {
  return (
    <Doughnut
      data={{
        labels,
        datasets: [{ data: values, backgroundColor: colors }],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "right" } },
      }}
    />
  );
}
