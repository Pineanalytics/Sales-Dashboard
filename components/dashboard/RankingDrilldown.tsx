"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { AchievementBadge, Badge } from "@/components/ui/Badge";
import { StockStatusPill } from "@/components/ui/StockPill";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatCompact, stockActionTier } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { RankingDrillRow, RankingDrillSummary } from "@/lib/rankingDrill";
import type { Dataset, StockItem } from "@/lib/types";
import type { ManagerRankingResult, SupervisorRankingResult } from "@/lib/tlRanking";

type Level = "supervisor" | "manager";

interface DrillEntity {
  id: string;
  name: string;
  principals: string[];
  achievedPct: number | null;
}

function contribution(value: number, total: number) {
  return total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "—";
}

function normalizedProduct(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const stockRiskRank: Record<string, number> = { bad: 0, warn: 1, neutral: 2, good: 3 };

function worstStock(items: StockItem[]) {
  return [...items].sort((a, b) => stockRiskRank[stockActionTier(a.action).tier] - stockRiskRank[stockActionTier(b.action).tier])[0];
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-strong">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-brand-navy">{value}</p>
      {note ? <p className="mt-0.5 text-[11px] text-muted">{note}</p> : null}
    </div>
  );
}

function AnalysisTable({
  title,
  nameHeading,
  rows,
  totalRevenue,
}: {
  title: string;
  nameHeading: string;
  rows: RankingDrillRow[];
  totalRevenue: number;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface p-3">
      <h3 className="mb-2 text-sm font-semibold text-brand-navy">{title}</h3>
      <TableWrap>
        <Thead>
          <Th align="center">#</Th><Th>{nameHeading}</Th><Th align="right">Revenue</Th><Th align="right">Contribution</Th><Th align="right">GP</Th><Th align="right">Margin</Th><Th align="right">Cases</Th>
        </Thead>
        <tbody>
          {rows.slice(0, 15).map((row, index) => (
            <tr key={`${row.name}-${index}`}>
              <Td align="center">{index + 1}</Td><Td className="font-medium">{row.name}</Td><Td align="right">{formatCompact(row.revenue)}</Td>
              <Td align="right">{contribution(row.revenue, totalRevenue)}</Td><Td align="right">{formatCompact(row.grossProfit)}</Td>
              <Td align="right">{row.grossMarginPct === null ? "—" : `${row.grossMarginPct.toFixed(1)}%`}</Td><Td align="right">{formatCompact(row.cases)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </section>
  );
}

export function RankingDrilldown({
  dataset,
  year,
  monthLabel,
  initialLevel,
  supervisorRanking,
  managerRanking,
  onClose,
}: {
  dataset: Dataset;
  year: string;
  monthLabel: string;
  initialLevel: Level;
  supervisorRanking: SupervisorRankingResult;
  managerRanking: ManagerRankingResult;
  onClose: () => void;
}) {
  const [level, setLevel] = useState<Level>(initialLevel);
  const [selectedId, setSelectedId] = useState("");
  const [principalScope, setPrincipalScope] = useState("all");
  const [summary, setSummary] = useState<RankingDrillSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [mounted, setMounted] = useState(false);

  const entities = useMemo<DrillEntity[]>(() => {
    if (level === "manager") {
      return managerRanking.rankings.map((manager) => ({
        id: manager.managerId,
        name: manager.managerName,
        principals: Array.from(new Set(manager.supervisors.flatMap((supervisor) => supervisor.principals))).sort(),
        achievedPct: manager.achievedPct,
      }));
    }
    return supervisorRanking.rankings.map((supervisor) => ({
      id: supervisor.supervisorId,
      name: supervisor.supervisorName,
      principals: supervisor.principals,
      achievedPct: supervisor.achievedPct,
    }));
  }, [level, managerRanking.rankings, supervisorRanking.rankings]);

  useEffect(() => {
    setSelectedId(entities[0]?.id ?? "");
    setPrincipalScope("all");
  }, [entities]);

  const selected = entities.find((entity) => entity.id === selectedId) ?? entities[0];
  const effectivePrincipals = principalScope === "all" ? (selected?.principals ?? []) : [principalScope];

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (principalScope !== "all" && !selected?.principals.includes(principalScope)) setPrincipalScope("all");
  }, [principalScope, selected]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (!selected || effectivePrincipals.length === 0) {
      setSummary(null);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ period: `${year}-${String(new Date(`${monthLabel} 1, ${year}`).getMonth() + 1).padStart(2, "0")}` });
    params.set("summary", "drill");
    effectivePrincipals.forEach((principal) => params.append("principal", principal));
    setSummary(null);
    setStatus("loading");
    fetch(`/api/brand-customer?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Unable to load SAP detail.");
        return (body as { drill: RankingDrillSummary }).drill;
      })
      .then((body) => {
        setSummary(body);
        setStatus("idle");
      })
      .catch((error) => {
        if (error.name !== "AbortError") setStatus("error");
      });
    return () => controller.abort();
  // A stable joined key prevents entity object identity from refetching the same scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthLabel, selected?.id, effectivePrincipals.join("|"), year]);

  const customers = summary?.customers ?? [];
  const reps = summary?.reps ?? [];
  const brands = summary?.brands ?? [];
  const principals = summary?.principals ?? [];
  const totalRevenue = summary?.totals.revenue ?? 0;
  const totalGrossProfit = summary?.totals.grossProfit ?? 0;
  const totalCases = summary?.totals.cases ?? 0;
  const principalKeys = new Set(effectivePrincipals.map(normalizePrincipalKey));
  const stockItems = dataset.stockItems
    .filter((item) => principalKeys.has(normalizePrincipalKey(item.principal)))
    .sort((a, b) => stockRiskRank[stockActionTier(a.action).tier] - stockRiskRank[stockActionTier(b.action).tier] || a.item.localeCompare(b.item));
  const stockByProduct = new Map<string, StockItem[]>();
  stockItems.forEach((item) => stockByProduct.set(normalizedProduct(item.item), [...(stockByProduct.get(normalizedProduct(item.item)) ?? []), item]));
  const stockAlerts = stockItems.filter((item) => ["bad", "warn"].includes(stockActionTier(item.action).tier)).length;
  const scopeLabel = principalScope === "all" ? `Combined portfolio (${effectivePrincipals.length} principal${effectivePrincipals.length === 1 ? "" : "s"})` : principalScope;

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] h-screen overflow-y-auto bg-background" role="dialog" aria-modal="true" aria-label="Sales hierarchy full analysis">
      <header className="sticky top-0 z-20 border-b border-border bg-surface px-4 py-3 shadow-sm md:px-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary-blue">SAP Sales Influence Drill</p>
            <h2 className="text-xl font-bold text-brand-navy">Supervisor & Manager Full Analysis</h2>
            <p className="text-xs text-muted-strong">{monthLabel} {year} · customer, rep, product and current stock context</p>
          </div>
          <button onClick={onClose} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-brand-navy hover:bg-background-elevated">
            <Dismiss20Regular /> Close
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="inline-flex rounded-full bg-background-elevated p-0.5">
            {(["supervisor", "manager"] as const).map((option) => (
              <button key={option} onClick={() => setLevel(option)} disabled={option === "manager" && managerRanking.rankings.length === 0} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${level === option ? "bg-secondary-blue text-white" : "text-muted-strong"}`}>
                By {option === "supervisor" ? "Supervisor" : "Manager"}
              </button>
            ))}
          </div>
          <label className="min-w-[260px] text-[11px] font-semibold uppercase tracking-wide text-muted-strong">
            Selected {level}
            <select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm normal-case text-foreground">
              {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
            </select>
          </label>
          <label className="min-w-[280px] text-[11px] font-semibold uppercase tracking-wide text-muted-strong">
            Analysis scope
            <select value={principalScope} onChange={(event) => setPrincipalScope(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm normal-case text-foreground">
              <option value="all">Combined portfolio ({selected?.principals.length ?? 0} principals)</option>
              {selected?.principals.map((principal) => <option key={principal} value={principal}>{principal} only</option>)}
            </select>
          </label>
          <div className="min-w-[180px] flex-1 text-xs text-muted-strong"><span className="font-semibold text-brand-navy">Scope:</span> {scopeLabel}</div>
          <div className="flex items-center gap-2 text-xs text-muted"><span>Portfolio ranking attainment</span><AchievementBadge pct={selected?.achievedPct} /></div>
        </div>
      </header>

      <main className="space-y-4 p-4 md:p-7">
        {status === "error" ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn&apos;t load SAP customer and product detail for this selection.</div> : null}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="SAP Revenue" value={status === "loading" ? "…" : formatCompact(totalRevenue)} />
          <Metric label="Gross Profit" value={status === "loading" ? "…" : formatCompact(totalGrossProfit)} />
          <Metric label="GP Margin" value={totalRevenue > 0 ? `${((totalGrossProfit / totalRevenue) * 100).toFixed(1)}%` : "—"} />
          <Metric label="Cases" value={formatCompact(totalCases)} />
          <Metric label="Customers" value={status === "loading" ? "…" : formatCompact(summary?.totals.customerCount ?? 0)} />
          <Metric label="Sales Reps" value={status === "loading" ? "…" : formatCompact(summary?.totals.repCount ?? 0)} />
          <Metric label="Top 5 Customer Share" value={summary?.totals.topFiveCustomerSharePct == null ? "—" : `${summary.totals.topFiveCustomerSharePct.toFixed(1)}%`} note="Concentration" />
          <Metric label="Stock Alerts" value={formatCompact(stockAlerts)} note="Current snapshot" />
        </div>

        <p className="text-xs text-muted-strong">SAP customer and product detail uses the selected month. Stock is the latest direct SAP snapshot{dataset.stockSource?.sourceDate ? ` as at ${dataset.stockSource.sourceDate}` : ""}; it is not a historical month-end balance.</p>

        <div className="grid gap-4 xl:grid-cols-2">
          <AnalysisTable title="Top SAP Customers" nameHeading="Customer" totalRevenue={totalRevenue} rows={customers} />
          <AnalysisTable title="Top SAP Sales Reps" nameHeading="Sales Rep" totalRevenue={totalRevenue} rows={reps} />
        </div>

        <section className="rounded-xl border border-border bg-surface p-3">
          <h3 className="mb-2 text-sm font-semibold text-brand-navy">Principal Contribution</h3>
          <TableWrap><Thead><Th align="center">#</Th><Th>Principal</Th><Th align="right">Revenue</Th><Th align="right">Contribution</Th><Th align="right">Gross Profit</Th><Th align="right">GP Margin</Th><Th align="right">Cases</Th></Thead>
            <tbody>{principals.map((row, index) => <tr key={row.name}><Td align="center">{index + 1}</Td><Td className="font-medium">{row.name}</Td><Td align="right">{formatCompact(row.revenue)}</Td><Td align="right">{contribution(row.revenue, totalRevenue)}</Td><Td align="right">{formatCompact(row.grossProfit)}</Td><Td align="right">{row.grossMarginPct === null ? "—" : `${row.grossMarginPct.toFixed(1)}%`}</Td><Td align="right">{formatCompact(row.cases)}</Td></tr>)}</tbody>
          </TableWrap>
        </section>

        <section className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-brand-navy">Top Brands / Products, Margin & Availability</h3><p className="text-xs text-muted">Availability uses an exact product-name match only.</p></div>
          <TableWrap><Thead><Th align="center">Rank</Th><Th>Brand / Product</Th><Th align="right">Revenue</Th><Th align="right">Contribution</Th><Th align="right">GP</Th><Th align="right">Margin</Th><Th align="right">Cases</Th><Th align="center">Current Stock</Th></Thead>
            <tbody>{brands.map((row, index) => { const stock = worstStock(stockByProduct.get(normalizedProduct(row.name)) ?? []); return <tr key={row.name}><Td align="center">{index + 1}</Td><Td className="font-medium">{row.name}</Td><Td align="right">{formatCompact(row.revenue)}</Td><Td align="right">{contribution(row.revenue, totalRevenue)}</Td><Td align="right">{formatCompact(row.grossProfit)}</Td><Td align="right">{row.grossMarginPct === null ? "—" : `${row.grossMarginPct.toFixed(1)}%`}</Td><Td align="right">{formatCompact(row.cases)}</Td><Td align="center">{stock ? <StockStatusPill action={stock.action} /> : <Badge tier="neutral">No stock match</Badge>}</Td></tr>; })}</tbody>
          </TableWrap>
        </section>

        <section className="rounded-xl border border-border bg-surface p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold text-brand-navy">Current Stock Risk Detail</h3><p className="text-xs text-muted">Out of stock and running-out lines rank first.</p></div>
          <TableWrap><Thead><Th>Principal</Th><Th>Item</Th><Th align="right">Opening Pcs</Th><Th align="right">Opening Value</Th><Th align="right">Days Cover</Th><Th align="center">Status</Th></Thead>
            <tbody>{stockItems.slice(0, 40).map((item, index) => <tr key={`${item.principal}-${item.item}-${index}`}><Td>{item.principal}</Td><Td className="font-medium">{item.item}</Td><Td align="right">{formatCompact(item.openingPcs)}</Td><Td align="right">{formatCompact(item.openingValue)}</Td><Td align="right">{item.daysCover.toFixed(1)}</Td><Td align="center"><StockStatusPill action={item.action} /></Td></tr>)}</tbody>
          </TableWrap>
        </section>
      </main>
    </div>,
    document.body
  );
}
