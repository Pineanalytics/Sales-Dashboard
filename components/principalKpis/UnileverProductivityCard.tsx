import type { UnileverPjpCard } from "@/lib/unileverKpi";

function kes(value: number): string {
  return `KES ${Math.round(value).toLocaleString("en-US")}`;
}

function achievementColor(pct: number | null): string {
  if (pct === null) return "text-white/50";
  if (pct >= 100) return "text-emerald-400";
  if (pct >= 80) return "text-amber-400";
  return "text-red-400";
}

/** Dark, presentation-style KPI scorecard for one Unilever PJP/rep, matching
 * the field team's existing "Individual Sales Productivity" report format.
 * A row renders as "Pending setup" with its reason, rather than a fabricated
 * value, whenever its source data hasn't synced for this PJP/month yet (see
 * lib/unileverKpi.ts's module comment) — most rows are real numbers once the
 * sync has run, including Geo-Match, which can genuinely compute to 0%. */
export function UnileverProductivityCard({ card }: { card: UnileverPjpCard }) {
  const computedKpis = card.kpis.filter((k) => k.status === "computed");
  const metKpis = computedKpis.filter((k) => k.targetValue !== null && k.actualValue !== null && k.actualValue >= k.targetValue);
  const pendingReasons = Array.from(new Set(card.kpis.filter((k) => k.status === "pending" && k.pendingReason).map((k) => k.pendingReason as string)));

  return (
    <div className="overflow-hidden rounded-2xl bg-[#111417] shadow-[0_4px_24px_rgba(0,0,0,0.35)]">
      <div className="bg-gradient-to-br from-emerald-800 to-emerald-950 px-6 py-5">
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-200">Pinefrost | Unilever {card.distributorLabel}</p>
        <h3 className="mt-1 text-xl font-bold text-white">Individual Sales Productivity</h3>
        <p className="mt-1 text-sm text-emerald-100">{card.repName} | {card.pjp}</p>
        <p className="mt-0.5 text-xs text-emerald-200/80">
          MTD as at {new Date(`${card.asOf}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} | {card.workingDaysElapsed} of {card.workingDaysTotal} working days
        </p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-sm font-semibold text-white">Sales achievement</p>
          <p className="mt-2 text-sm text-white/70">Actual: <span className="font-semibold text-white">{kes(card.sales.actual)}</span></p>
          <p className="text-sm text-white/70">Balance: <span className="font-semibold text-white">{card.sales.balance === null ? "—" : kes(card.sales.balance)}</span></p>
        </div>
        <div className="text-right">
          <p className={`text-3xl font-bold ${achievementColor(card.sales.achievementPct)}`}>{card.sales.achievementPct === null ? "—" : `${card.sales.achievementPct}%`}</p>
          <p className="mt-2 text-sm text-white/70">Target: <span className="font-semibold text-white">{card.sales.target === null ? "—" : kes(card.sales.target)}</span></p>
          <p className="text-sm text-red-300">MTD pace: {card.sales.pacePct}%</p>
        </div>
      </div>

      <div className="px-6 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-white/50">
              <th className="pb-2 font-medium">KPI</th>
              <th className="pb-2 font-medium text-right">Target</th>
              <th className="pb-2 font-medium text-right">Actual</th>
              <th className="pb-2 font-medium text-right">Gap</th>
            </tr>
          </thead>
          <tbody>
            {card.kpis.map((row) => (
              <tr key={row.key} className="border-t border-white/10">
                <td className="py-2 text-white/90">{row.label}</td>
                <td className="py-2 text-right text-white/70">{row.targetLabel}</td>
                <td className={`py-2 text-right font-semibold ${row.status === "pending" ? "text-white/40" : "text-red-300"}`}>
                  {row.status === "pending" ? "Pending setup" : row.actualLabel}
                </td>
                <td className="py-2 text-right text-white/50">{row.gapLabel ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mx-6 mb-4 rounded-xl bg-white/5 px-4 py-3">
        <p className="text-sm font-semibold text-white">Overall KPI achievement</p>
        <p className="mt-1 text-xs text-white/60">
          {metKpis.length} / {computedKpis.length || "0"} computed KPIs met{pendingReasons.length > 0 ? ` — ${card.kpis.filter((k) => k.status === "pending").length} pending setup` : ""}.
        </p>
      </div>

      <div className="mx-6 mb-4 grid grid-cols-2 gap-x-6 gap-y-1 rounded-xl bg-white/5 px-4 py-3 text-sm">
        <p className="col-span-2 font-semibold text-white">MTD execution gaps</p>
        <p className="text-white/70">ECO: <span className="font-semibold text-white">{card.gaps.ecoOutletsCovered ?? "—"}</span> / <span className="text-white/50">{card.gaps.ecoOutletsUniverse ?? "universe unknown"}</span> outlets</p>
        <p className="text-white/70">PA outlets: <span className="font-semibold text-white">{card.gaps.paOutletsQualifying ?? "—"}</span> / <span className="text-white/50">{card.gaps.paOutletsTotal ?? "—"}</span></p>
        <p className="text-white/70">BP: <span className="font-semibold text-white">{card.gaps.bpCallsBilled ?? "—"}</span> / <span className="text-white/50">{card.gaps.bpCallsTotal ?? "—"}</span> calls</p>
        <p className="text-white/70">SKU lines: <span className="font-semibold text-white">{card.gaps.skuLines.toLocaleString("en-US")}</span></p>
      </div>

      {card.recoveryPriorities.length > 0 ? (
        <div className="mx-6 mb-6 rounded-xl bg-gradient-to-br from-emerald-800 to-emerald-950 px-4 py-3">
          <p className="text-sm font-semibold text-white">Daily recovery priorities</p>
          <ul className="mt-1 space-y-1 text-sm text-emerald-100">
            {card.recoveryPriorities.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {pendingReasons.length > 0 ? (
        <div className="mx-6 mb-6 rounded-xl border border-white/10 px-4 py-3 text-xs text-white/50">
          <p className="font-semibold text-white/70">Why some rows show &quot;Pending setup&quot;</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {pendingReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
