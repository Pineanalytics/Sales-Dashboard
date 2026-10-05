"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BreakdownRow, OutletStatus } from "@/lib/outletUniverse/query";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const ACTIVE_COLOR = CHART_COLORS[1];
const INACTIVE_COLOR = CHART_COLORS[9];

/** Active (and, when the status filter allows, inactive) outlet counts per
 *  dimension value. Clicking a bar drills into it by setting that filter. */
export function BreakdownChart({
  rows,
  status,
  layout,
  onPick,
  rowHeight = 26,
}: {
  rows: BreakdownRow[];
  status: OutletStatus;
  layout: "horizontal" | "vertical";
  onPick?: (name: string) => void;
  rowHeight?: number;
}) {
  const data = rows.map((row) => ({ name: row.name, Active: row.active, Inactive: Math.max(0, row.total - row.active) }));
  const showActive = status !== "inactive";
  const showInactive = status !== "active";
  const pick = (entry: unknown) => {
    const name = (entry as { name?: string } | null)?.name;
    if (name && onPick) onPick(name);
  };
  const barProps = { stackId: "outlets", cursor: onPick ? "pointer" : "default", onClick: pick } as const;

  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted">No outlets match these filters.</p>;

  if (layout === "vertical") {
    return (
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
          <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} />
          <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
          <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
          {showActive && showInactive ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {showActive ? <Bar dataKey="Active" fill={ACTIVE_COLOR} radius={showInactive ? 0 : [6, 6, 0, 0]} {...barProps} /> : null}
          {showInactive ? <Bar dataKey="Inactive" fill={INACTIVE_COLOR} radius={[6, 6, 0, 0]} {...barProps} /> : null}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * rowHeight + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
        <XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} />
        <YAxis type="category" dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} width={130} interval={0} />
        <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
        {showActive && showInactive ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {showActive ? <Bar dataKey="Active" fill={ACTIVE_COLOR} radius={showInactive ? 0 : [0, 6, 6, 0]} {...barProps} /> : null}
        {showInactive ? <Bar dataKey="Inactive" fill={INACTIVE_COLOR} radius={[0, 6, 6, 0]} {...barProps} /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
}
