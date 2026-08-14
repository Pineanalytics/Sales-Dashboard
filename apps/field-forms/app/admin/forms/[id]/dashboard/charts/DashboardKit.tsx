import { DASH_COLORS } from "./ChartSetup";

export function KpiTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="rounded-[10px] px-3.5 py-4 text-white shadow-[0_2px_6px_rgba(0,0,0,0.08)]"
      style={{ background: color }}
    >
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-90">
        {label}
      </div>
      <div className="text-[26px] font-bold mt-2 [font-variant-numeric:tabular-nums]">
        {value}
      </div>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-[10px] p-[18px] mb-[18px] shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
      style={{ border: `1px solid ${DASH_COLORS.border}` }}
    >
      {(title || action) && (
        <div className="flex items-center justify-between mb-3.5">
          {title && (
            <h3 className="m-0 text-[15px]" style={{ color: DASH_COLORS.navy }}>
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function ChartWrap({
  children,
  tall = false,
}: {
  children: React.ReactNode;
  tall?: boolean;
}) {
  return (
    <div className="relative" style={{ height: tall ? 360 : 300 }}>
      {children}
    </div>
  );
}

export function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-[18px]">{children}</div>;
}

export function DataTable({
  headers,
  rows,
  scroll = true,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  scroll?: boolean;
}) {
  const table = (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {headers.map((h) => (
            <th
              key={h}
              className="text-left font-semibold px-2.5 py-2.5 sticky top-0"
              style={{ background: DASH_COLORS.lightblue, color: DASH_COLORS.navy }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} className="hover:bg-[#F7FAFF]">
            {row.map((cell, j) => (
              <td
                key={j}
                className="px-2.5 py-2"
                style={{ borderBottom: `1px solid ${DASH_COLORS.border}` }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (!scroll) return table;
  return (
    <div
      className="max-h-[520px] overflow-auto rounded-lg"
      style={{ border: `1px solid ${DASH_COLORS.border}` }}
    >
      {table}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "critical" | "good" | "warning";
  children: React.ReactNode;
}) {
  const bg =
    tone === "critical"
      ? DASH_COLORS.red
      : tone === "warning"
        ? DASH_COLORS.amber
        : DASH_COLORS.green;
  return (
    <span
      className="inline-block px-2.5 py-[3px] rounded-full text-[11px] font-semibold text-white"
      style={{ background: bg }}
    >
      {children}
    </span>
  );
}
