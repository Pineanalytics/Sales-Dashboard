interface Point {
  date: string;
  value: number;
}

// Single-series trend over time — a plain line, one hue, dots on data
// points, native title tooltip per point.
export function ShareTrend({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-[var(--ink-600)]">No data yet.</p>;
  }
  if (points.length === 1) {
    return (
      <p className="text-2xl font-display text-[var(--pine-700)] [font-variant-numeric:tabular-nums]">
        {points[0].value.toFixed(1)}%
      </p>
    );
  }

  const width = 560;
  const height = 120;
  const padX = 8;
  const padY = 14;
  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const range = max - min || 1;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (width - padX * 2);
    const y =
      height - padY - ((p.value - min) / range) * (height - padY * 2);
    return { x, y, p };
  });

  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-28"
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--pine-500)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {coords.map((c, i) => (
        <g key={i}>
          <circle cx={c.x} cy={c.y} r={3.5} fill="var(--pine-700)" />
          <title>
            {new Date(c.p.date).toLocaleDateString()}: {c.p.value.toFixed(1)}%
          </title>
        </g>
      ))}
    </svg>
  );
}
