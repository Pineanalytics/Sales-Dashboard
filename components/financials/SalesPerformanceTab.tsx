"use client";

import { useState } from "react";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";
import { ReceivablesKpi, money } from "@/components/views/ReceivablesView";
import { formatCompact, formatPercent, achievementTier, marginTier, tierTextClass } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import {
  summarizeSalesForPeriod,
  summarizeSalesByPrincipal,
  getCurrentMonthPeriod,
  getPriorYearPeriod,
  type PeriodSelection,
} from "@/lib/timeIntelligence";
import type { Dataset } from "@/lib/types";
import type { DebtAttribution } from "@/lib/financeDebtAttribution";
import { updateFinanceSettingsAction } from "@/app/(protected)/(analytics)/financials/actions";

// Fixed top-5 principal set (given directly, not derived by any ranking) —
// shown versus their own target, rolled up across every location-split raw
// Principal string that belongs to the same brand (e.g. "EABL-Nyeri" and
// "EABL-Nyahururu" both fold into "Eabl").
const TOP_5_PRINCIPALS = ["Mars", "Suntory", "Upfield", "Eabl", "Weetabix"];

export function SalesPerformanceTab({
  dataset,
  selectedPrincipalKey,
  grossMarginTargetPct,
  receivablesOutstanding,
  debtAttribution,
  isAdmin,
}: {
  dataset: Dataset;
  selectedPrincipalKey: string | null;
  grossMarginTargetPct: number | null;
  receivablesOutstanding: number;
  debtAttribution: DebtAttribution;
  isAdmin: boolean;
}) {
  const mtdPeriod = getCurrentMonthPeriod(dataset);
  const ytdPeriod: PeriodSelection = { kind: "YTD", year: mtdPeriod.year, month: mtdPeriod.month };
  const lyspPeriod = getPriorYearPeriod(mtdPeriod);

  const mtd = summarizeSalesForPeriod(dataset, mtdPeriod, selectedPrincipalKey);
  const ytd = summarizeSalesForPeriod(dataset, ytdPeriod, selectedPrincipalKey);
  const lysp = summarizeSalesForPeriod(dataset, lyspPeriod, selectedPrincipalKey);

  const byPrincipal = Array.from(summarizeSalesByPrincipal(dataset, mtdPeriod).values());
  const top5 = TOP_5_PRINCIPALS.map((label) => {
    const key = normalizePrincipalKey(label);
    const rows = byPrincipal.filter((p) => normalizePrincipalKey(p.principal) === key);
    let revenue = 0;
    let target = 0;
    let hasTarget = false;
    for (const r of rows) {
      revenue += r.revenue;
      if (r.target !== null) {
        target += r.target;
        hasTarget = true;
      }
    }
    const achievementPct = hasTarget && target > 0 ? Math.round((revenue / target) * 1000) / 10 : null;
    return { label, revenue, target: hasTarget ? target : null, achievementPct };
  });
  const costOfSales = [...byPrincipal].sort((a, b) => b.cogs - a.cogs);

  const stockValue = dataset.stockTotal.value;
  const workingCapital = stockValue + receivablesOutstanding;

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Sales performance summary">
        <KpiGrid>
          <KpiCard accent="revenue" label="Revenue (MTD)" value={formatCompact(mtd.revenue)} />
          <KpiCard accent="mission" label="Vs Running Target" value={<span className={tierTextClass[achievementTier(mtd.achievementPct)]}>{formatPercent(mtd.achievementPct)}</span>} sublabel={mtd.target !== null ? `Target ${formatCompact(mtd.target)}` : "N/T"} />
          <KpiCard accent="revenue" label="Revenue (YTD)" value={formatCompact(ytd.revenue)} />
          <KpiCard accent="revenue" label="LYSP Revenue" value={formatCompact(lysp.revenue)} sublabel={`${lyspPeriod.month} ${lyspPeriod.year}`} />
          <KpiCard accent="growth" label="Gross Profit (MTD)" value={formatCompact(mtd.grossProfit)} />
          <KpiCard
            accent="growth"
            label="GP Margin vs Target"
            value={<span className={tierTextClass[marginTier(mtd.grossMarginPct)]}>{formatPercent(mtd.grossMarginPct)}</span>}
            sublabel={grossMarginTargetPct !== null ? `Target ${grossMarginTargetPct}%` : "No target set"}
          />
        </KpiGrid>
        {isAdmin ? <GrossMarginTargetEditor current={grossMarginTargetPct} /> : null}
      </SectionCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard title="Top 5 principals vs Target" action={<span className="text-xs text-muted">Mars, Suntory, Upfield, Eabl, Weetabix</span>}>
          <TableWrap>
            <Thead><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Target</Th><Th align="right">Achievement</Th></Thead>
            <tbody>
              {top5.map((p) => (
                <tr key={p.label}>
                  <Td>{p.label}</Td>
                  <Td align="right">{formatCompact(p.revenue)}</Td>
                  <Td align="right">{p.target !== null ? formatCompact(p.target) : "N/T"}</Td>
                  <Td align="right"><span className={tierTextClass[achievementTier(p.achievementPct)]}>{formatPercent(p.achievementPct)}</span></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>

        <SectionCard title="Cost of Sales per principal">
          <TableWrap>
            <Thead><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Cost of Sales</Th><Th align="right">COGS %</Th></Thead>
            <tbody>
              {costOfSales.map((p) => (
                <tr key={p.principalKey}>
                  <Td>{p.principal}</Td>
                  <Td align="right">{formatCompact(p.revenue)}</Td>
                  <Td align="right">{formatCompact(p.cogs)}</Td>
                  <Td align="right">{p.revenue > 0 ? formatPercent((p.cogs / p.revenue) * 100) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>
      </div>

      <SectionCard title="Debt by principal" action={<span className="text-xs text-muted">{debtAttribution.windowLabel} purchase mix, prorated across live outstanding</span>}>
        <TableWrap>
          <Thead><Th>Principal</Th><Th align="right">Debt</Th><Th align="right">% of overall debt</Th></Thead>
          <tbody>
            {debtAttribution.byPrincipal.map((p) => (
              <tr key={p.principal}>
                <Td>{p.principal}</Td>
                <Td align="right">{money(p.debt)}</Td>
                <Td align="right">{formatPercent(p.pctOfTotal)}</Td>
              </tr>
            ))}
            {debtAttribution.byPrincipal.length === 0 ? <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">No outstanding debt to attribute.</td></tr> : null}
          </tbody>
        </TableWrap>
      </SectionCard>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ReceivablesKpi label="Working capital (proxy)" value={money(workingCapital)} sublabel="Stock value + Receivables outstanding" />
        <div className="grid grid-cols-2 gap-3">
          <ReceivablesKpi label="Stock opening balance (value)" value={money(stockValue)} sublabel="Company-wide" />
          <ReceivablesKpi label="Stock opening balance (volume)" value={formatCompact(dataset.stockTotal.volume)} sublabel="Cases" />
        </div>
      </div>
    </div>
  );
}

function GrossMarginTargetEditor({ current }: { current: number | null }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)} className="mt-3 text-xs font-semibold text-secondary-blue hover:text-primary-blue">
        {current !== null ? "Edit GP margin target" : "Set GP margin target"}
      </button>
    );
  }
  return (
    <form action={updateFinanceSettingsAction} className="mt-3 flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-muted-strong" htmlFor="grossMarginTargetPct">GP margin target %</label>
      <input
        id="grossMarginTargetPct"
        name="grossMarginTargetPct"
        type="number"
        step="0.1"
        min={0}
        max={100}
        defaultValue={current ?? undefined}
        className="w-24 rounded-lg border border-border bg-background px-2 py-1 text-sm"
      />
      <button type="submit" className="rounded-full bg-[#075a4b] px-3 py-1 text-xs font-semibold text-white">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-strong">Cancel</button>
    </form>
  );
}
