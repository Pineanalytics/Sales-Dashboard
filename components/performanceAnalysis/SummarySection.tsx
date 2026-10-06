"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { buildFindings } from "@/lib/performanceAnalysis/narrative";
import type { PerformancePayload } from "@/lib/performanceAnalysis/types";
import { Growth, Rich, count, kes, pct } from "./shared";

export function SummarySection({ p }: { p: PerformancePayload }) {
  const k = p.kpi;
  const quarter = p.labels.cq && p.labels.pq ? `${p.labels.cq} vs ${p.labels.pq}` : null;
  const month = p.labels.cm && p.labels.pm ? `${p.labels.cm} vs ${p.labels.pm}` : null;
  const findings = buildFindings(p);

  return (
    <section id="summary" className="flex scroll-mt-4 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <KpiCard size="fit" accent="revenue" label="Net sales YTD" value={kes(k.sales)} sublabel={`Gross invoiced ${kes(k.gross)}`} />
        <KpiCard size="fit" accent="growth" label="Gross profit YTD" value={kes(k.gp)} sublabel={`GP margin ${pct(k.gpm, 2)}`} />
        <KpiCard
          size="fit"
          accent="quarter"
          label={quarter ? `${quarter} sales` : "Quarter sales"}
          value={k.cqSales !== null ? kes(k.cqSales) : "–"}
          sublabel={k.cqSales !== null ? <><Growth value={k.cqSalesGrowth} /> vs {kes(k.pqSales)}</> : "Needs two complete quarters"}
        />
        <KpiCard
          size="fit"
          accent="quarter"
          label={quarter ? `${quarter} GP` : "Quarter GP"}
          value={k.cqGp !== null ? kes(k.cqGp) : "–"}
          sublabel={k.cqGp !== null ? <><Growth value={k.cqGpGrowth} /> vs {kes(k.pqGp)}</> : "Needs two complete quarters"}
        />
        <KpiCard
          size="fit"
          accent="mission"
          label={month ?? "Month"}
          value={k.cmSales !== null ? kes(k.cmSales) : "–"}
          sublabel={k.cmSales !== null && k.pmSales !== null ? <><Growth value={k.cmGrowth} /> vs {kes(k.pmSales)}</> : "Needs two full months"}
        />
        <KpiCard size="fit" accent="revenue" label="Credit notes" value={kes(-k.cn)} sublabel={`${pct(k.cnPct)} of gross invoicing`} />
        <KpiCard size="fit" accent="coverage" label="Active accounts" value={count(p.concentration.active)} sublabel={`${count(k.skus)} SKUs sold`} />
      </div>
      {findings.length > 0 ? (
        <div className="rounded-xl bg-dark-navy p-5 text-white shadow-[0_4px_14px_rgba(11,61,53,0.18)]">
          <h2 className="mb-3 text-xl font-semibold">What the numbers say</h2>
          <ol className="grid list-decimal gap-2 pl-5 text-sm leading-relaxed text-white/90">
            {findings.map((finding, index) => (
              <li key={index} className="max-w-[95ch] [&_strong]:text-amber-200">
                <Rich text={finding} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
