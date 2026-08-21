"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TargetArrow20Regular } from "@fluentui/react-icons";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { EmptyState } from "@/components/ui/EmptyState";
import { ChartGrid, KpiGrid, SectionCard } from "@/components/ui/KpiGrid";
import { KpiCard } from "@/components/ui/KpiCard";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import { formatCompact, formatNumber, formatPercent } from "@/lib/format";
import { CHART_AXIS_COLOR, CHART_COLORS, CHART_GRID_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

type Summary = {
  current: { ptdSsu: number; ytdSsu: number; ptdCases: number; ytdCases: number; ptdRevenue: number; ytdRevenue: number; ptdOutlets: number; ytdOutlets: number };
  prior: { ptdSsu: number; ytdSsu: number; ptdCases: number; ytdCases: number; ptdRevenue: number; ytdRevenue: number; ptdOutlets: number; ytdOutlets: number };
  target: { ptdSsuTarget: number; ytdSsuTarget: number; fullSsuTarget: number; ptdValueTarget: number; ytdValueTarget: number; fullValueTarget: number; ptdUniverseTarget: number; ytdCoverageTarget: number };
  ptdAchievement: number | null; ytdAchievement: number | null; fullYearAchievement: number | null; ptdGrowth: number | null; ytdGrowth: number | null; ptdCoverage: number | null;
};
interface MarsData { principal: string; available: boolean; fiscalYear?: string; priorYear?: string; selectedPeriod?: number; periods?: { periodKey: string; periodNo: number; startDate: string; endDate: string }[]; summary?: Summary; byPeriod?: { periodKey: string; periodNo: number; ssu: number; revenue: number; outlets: number }[]; bySeller?: { name: string; ssu: number; revenue: number; outlets: number }[]; byBrand?: { name: string; ssu: number; revenue: number }[]; }

export default function PrincipalKpisPage() {
  const [data, setData] = useState<MarsData | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const params = new URLSearchParams();
    if (period) params.set("period", String(period));
    fetch(`/api/principal-kpis/mars?${params}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Unable to load Mars KPI data."); return response.json() as Promise<MarsData>; })
      .then((body) => { if (!cancelled) { setData(body); setState("ready"); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [period]);

  if (state === "loading" && !data) return <FullPageSpinner label="Loading Principal KPIs…" />;
  if (state === "error" || !data) return <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="Couldn't load Principal KPIs" description="Try refreshing the page. If the issue persists, the Mars reference import may need attention." />;
  if (!data.available || !data.summary) return <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="Mars KPI data is being prepared" description="The Mars fiscal calendar, targets, roster and Pine sales ledger are not loaded yet." />;

  const { summary, periods = [], selectedPeriod = 1, fiscalYear = "", priorYear = "", byPeriod = [], bySeller = [], byBrand = [] } = data;
  const selected = periods.find((item) => item.periodNo === selectedPeriod);
  const periodLabel = selected ? `${selected.periodKey} · ${new Date(selected.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ${new Date(selected.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : `P${String(selectedPeriod).padStart(2, "0")}`;
  const sellerData = bySeller.map((item, index) => ({ ...item, fill: CHART_COLORS[index % CHART_COLORS.length] }));

  return <div className="flex flex-col gap-6">
    <SectionCard title="Principal KPI workspace" action={<span className="text-xs text-muted">Mars is the first configured principal. Additional principal scorecards will appear here when their KPI models are approved.</span>}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-xs font-medium text-muted">Principal
          <select value="Mars" disabled className="h-10 min-w-44 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground disabled:opacity-100"><option>Mars</option></select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-muted">Fiscal period
          <select value={selectedPeriod} onChange={(event) => setPeriod(Number(event.target.value))} className="h-10 min-w-64 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground">
            {periods.map((item) => <option value={item.periodNo} key={item.periodKey}>{item.periodKey} · {new Date(item.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – {new Date(item.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</option>)}
          </select>
        </label>
        <p className="pb-2 text-sm text-muted">FY {fiscalYear} through <span className="font-semibold text-foreground">{periodLabel}</span>, compared with FY {priorYear} through the same period.</p>
      </div>
    </SectionCard>

    <KpiGrid>
      <KpiCard accent="revenue" label="PTD SSU" value={<AnimatedValue value={summary.current.ptdSsu} format={formatNumber} />} delta={summary.ptdGrowth === null ? undefined : { value: summary.ptdGrowth, caption: `vs FY ${priorYear}` }} />
      <KpiCard accent="coverage" label="PTD SSU Achievement" value={<AnimatedValue value={summary.ptdAchievement ?? 0} format={(v) => v === 0 && summary.ptdAchievement === null ? "—" : formatPercent(v / 100)} />} />
      <KpiCard accent="growth" label="Fiscal YTD SSU" value={<AnimatedValue value={summary.current.ytdSsu} format={formatNumber} />} delta={summary.ytdGrowth === null ? undefined : { value: summary.ytdGrowth, caption: `vs FY ${priorYear}` }} />
      <KpiCard accent="quarter" label="Fiscal YTD Achievement" value={<AnimatedValue value={summary.ytdAchievement ?? 0} format={(v) => v === 0 && summary.ytdAchievement === null ? "—" : formatPercent(v / 100)} />} />
      <KpiCard accent="coverage" label="Productive Outlets (PTD)" value={<AnimatedValue value={summary.current.ptdOutlets} format={formatNumber} />} sublabel={summary.target.ptdUniverseTarget > 0 ? `${formatPercent((summary.ptdCoverage ?? 0) / 100)} of ${formatNumber(summary.target.ptdUniverseTarget)} universe` : undefined} />
      <KpiCard accent="revenue" label="Fiscal YTD Revenue" value={<AnimatedValue value={summary.current.ytdRevenue} format={formatCompact} />} />
    </KpiGrid>

    <ChartGrid>
      <SectionCard title="Fiscal Period Trend — SSU">
        <ResponsiveContainer width="100%" height={300}><LineChart data={byPeriod} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} /><XAxis dataKey="periodKey" stroke={CHART_AXIS_COLOR} fontSize={11} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={11} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatNumber(Number(value))} /><Line dataKey="ssu" name="SSU" type="monotone" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer>
      </SectionCard>
      <SectionCard title="Fiscal YTD SSU by Seller Type">
        <ResponsiveContainer width="100%" height={300}><BarChart data={sellerData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} /><XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} /><YAxis type="category" dataKey="name" width={95} stroke={CHART_AXIS_COLOR} fontSize={11} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatNumber(Number(value))} /><Bar dataKey="ssu" name="SSU" radius={[0, 6, 6, 0]}>{sellerData.map((item, index) => <Cell key={`${item.name}-${index}`} fill={item.fill} />)}</Bar></BarChart></ResponsiveContainer>
      </SectionCard>
    </ChartGrid>

    <ChartGrid>
      <SectionCard title="Brand / Product Mix — Fiscal YTD"><TableWrap><Thead><Th>Brand</Th><Th align="right">SSU</Th><Th align="right">Revenue</Th></Thead><tbody>{byBrand.map((row) => <tr key={row.name}><Td>{row.name}</Td><Td align="right">{formatNumber(row.ssu)}</Td><Td align="right">{formatCompact(row.revenue)}</Td></tr>)}</tbody></TableWrap></SectionCard>
      <SectionCard title="Mars KPI scorecard"><TableWrap><Thead><Th>Measure</Th><Th align="right">PTD</Th><Th align="right">Fiscal YTD</Th><Th align="right">FY Target</Th></Thead><tbody>
        <tr><Td>SSU</Td><Td align="right">{formatNumber(summary.current.ptdSsu)}</Td><Td align="right">{formatNumber(summary.current.ytdSsu)}</Td><Td align="right">{formatNumber(summary.target.fullSsuTarget)}</Td></tr>
        <tr><Td>Cases</Td><Td align="right">{formatNumber(summary.current.ptdCases)}</Td><Td align="right">{formatNumber(summary.current.ytdCases)}</Td><Td align="right">—</Td></tr>
        <tr><Td>Revenue</Td><Td align="right">{formatCompact(summary.current.ptdRevenue)}</Td><Td align="right">{formatCompact(summary.current.ytdRevenue)}</Td><Td align="right">{formatCompact(summary.target.fullValueTarget)}</Td></tr>
        <tr><Td>Productive outlets</Td><Td align="right">{formatNumber(summary.current.ptdOutlets)}</Td><Td align="right">{formatNumber(summary.current.ytdOutlets)}</Td><Td align="right">—</Td></tr>
      </tbody></TableWrap></SectionCard>
    </ChartGrid>
  </div>;
}
