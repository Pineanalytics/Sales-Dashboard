"use client";

import { useEffect, useState } from "react";
import { achievementTier, tierBarColor } from "@/lib/format";

interface AchievementGaugeProps {
  pct: number | null;
  size?: number;
}

/** Circular progress ring with an animated fill and a bold center percentage — used for achievement-style KPIs. */
export function AchievementGauge({ pct, size = 48 }: AchievementGaugeProps) {
  const strokeWidth = Math.min(8, Math.max(4, Math.round(size / 9)));
  const fontSize = Math.max(11, Math.round(size * 0.22));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const tier = achievementTier(pct);
  const color = tierBarColor[tier];
  const targetFillPct = pct === null ? 0 : Math.min(Math.max(pct, 0), 100);

  const [fillPct, setFillPct] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setFillPct(targetFillPct));
    return () => cancelAnimationFrame(id);
  }, [targetFillPct]);

  const offset = circumference - (fillPct / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="var(--border)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-[900ms] ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-bold tabular-nums" style={{ color, fontSize }}>
          {pct === null ? "N/T" : `${pct.toFixed(0)}%`}
        </span>
      </div>
    </div>
  );
}
