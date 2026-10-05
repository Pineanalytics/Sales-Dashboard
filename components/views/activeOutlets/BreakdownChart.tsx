"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BreakdownRow, OutletStatus } from "@/lib/outletUniverse/query";
import type { OutletSalesRole } from "@/lib/outletUniverse/normalize";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const PRIMARY_COLOR = CHART_COLORS[0];
const SECONDARY_COLOR = CHART_COLORS[2];

/** The count a bar shows for one role: active outlets, inactive ones, or the whole
 *  known universe, following the status filter. */
export function roleMetric(row: BreakdownRow, role: "Primary" | "Secondary", status: OutletStatus): number {
  const active = role === "Primary" ? row.activePrimary : row.activeSecondary;
  const total = role === "Primary" ? row.totalPrimary : row.totalSecondary;
  if (status === "active") return active;
  if (status === "inactive") return Math.max(0, total - active);
  return total;
}

/** Outlet counts per dimension value, split into Primary and Secondary Sales
 *  (stacked). Clicking a bar drills into it by setting that filter. */
export function BreakdownChart({
  rows,
  status,
  role,
  layout,
  onPick,
  rowHeight = 26,
}: {
  rows: BreakdownRow[];
  status: OutletStatus;
  role: OutletSalesRole | null;
  layout: "horizontal" | "vertical";
  onPick?: (name: string) => void;
  rowHeight?: number;
}) {
  const data = rows.map((row) => ({ name: row.name, Primary: roleMetric(row, "Primary", status), Secondary: roleMetric(row, "Secondary", status) }));
  const showPrimary = role !== "Secondary Sales";
  const showSecondary = role !== "Primary Sales";
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
          {showPrimary && showSecondary ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {showPrimary ? <Bar dataKey="Primary" fill={PRIMARY_COLOR} radius={showSecondary ? 0 : [6, 6, 0, 0]} {...barProps} /> : null}
          {showSecondary ? <Bar dataKey="Secondary" fill={SECONDARY_COLOR} radius={[6, 6, 0, 0]} {...barProps} /> : null}
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
        {showPrimary && showSecondary ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {showPrimary ? <Bar dataKey="Primary" fill={PRIMARY_COLOR} radius={showSecondary ? 0 : [0, 6, 6, 0]} {...barProps} /> : null}
        {showSecondary ? <Bar dataKey="Secondary" fill={SECONDARY_COLOR} radius={[0, 6, 6, 0]} {...barProps} /> : null}
      </BarChart>
    </ResponsiveContainer>
  );
}
