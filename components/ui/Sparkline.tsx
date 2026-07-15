"use client";

import { AreaChart, Area, ResponsiveContainer, YAxis } from "recharts";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
}

/** Minimal axis-less trend line for embedding inside a KpiCard — no gridlines, no
 *  tooltip, no legend, just the shape. Borrowed from the sparkline-in-stat-card
 *  pattern common to most modern admin dashboards (Tabler, TailAdmin). `YAxis` is
 *  present only to auto-scale the domain to the data's own min/max — it renders
 *  nothing visible. */
export function Sparkline({ data, color = "var(--secondary-blue)", height = 40 }: SparklineProps) {
  if (data.length < 2) return null;
  const chartData = data.map((value, i) => ({ i, value }));

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <defs>
            <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#sparkline-fill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
