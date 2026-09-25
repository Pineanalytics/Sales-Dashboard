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
import { UnileverProductivityCard } from "@/components/principalKpis/UnileverProductivityCard";
import type { UnileverPjpCard } from "@/lib/unileverKpi";

const UNILEVER_PRINCIPAL = "Unilever";
interface UnileverData { available: boolean; month: string; distributorOptions: { value: string; label: string }[]; cards: UnileverPjpCard[] }

type Summary = { current: { ptdSsu: number; ytdSsu: number; ptdRevenue: number; ytdRevenue: number; ptdOutlets: number; ptdProductive: number; ptdReturns: number }; prior: { ptdSsu: number }; target: { ptdSsuTarget: number; ytdSsuTarget: number }; ptdAchievement: number | null; ytdAchievement: number | null; ptdGrowth: number | null; ytdGrowth: number | null; ptdCoverage: number | null; ptdStrikeRate: number | null; ptdConversion: number | null };
type FilterKey = "sellerType" | "employeeGroup" | "location" | "teamLeader" | "fsr";
type LocationScorecard = { location: string; sellerType: string; stream: string; fullSsuTarget: number; ptdSsuTarget: number; ptdSsu: number; lyspSsu: number; universeTarget: number; visits: number; lyspVisits: number; productive: number; lyspProductive: number; lppc: number | null; dropSize: number | null };
interface MarsData { available: boolean; fiscalYear?: string; priorYear?: string; selectedPeriod?: number; timeMode?: "FISCAL" | "MONTH"; selectedMonth?: string; source?: "PINE" | "WORKBOOK"; asOf?: string | null; periods?: { periodKey: string; periodNo: number; startDate: string; endDate: string }[]; summary?: Summary; filterOptions?: { sellerTypes: string[]; employeeGroups: string[]; locations: string[]; teamLeaders: string[]; fsrs: string[] }; byPeriod?: { periodKey: string; periodNo: number; ssu: number; revenue: number; outlets: number }[]; bySeller?: { name: string; ptdSsu: number; ytdSsu: number; ptdRevenue: number; ytdRevenue: number; ptdVisits: number; ptdProductive: number }[]; byBrand?: { name: string; ssu: number; revenue: number }[]; rtmPerformance?: { name: string; ptdSsu: number; ptdRevenue: number; ptdVisits: number; ptdProductive: number }[]; rtmUniverse?: { name: string; customers: number }[]; locationScorecards?: LocationScorecard[]; repProductivityScorecards?: { employeeCode: string; employeeName: string; location: string; target: number; productive: number }[]; }
interface JbpData { available: boolean; fiscalYear?: string; selectedPeriod?: number; selectedMonth?: string; mode?: "FISCAL" | "MONTH"; windowLabel?: string; overall?: { casesTarget: number; cases: number; casesAchievement: number | null; ssuTarget: number; ssu: number; ssuAchievement: number | null } | null; categories?: { category: string; casesTarget: number; cases: number; casesAchievement: number | null; ssuTarget: number; ssu: number; ssuAchievement: number | null }[]; rows?: { customerId: string; customerName: string | null; category: string; tier: string | null; area: string | null; casesTarget: number; cases: number; casesAchievement: number | null; ssuTarget: number; ssu: number; ssuAchievement: number | null }[]; }

const commercialStreams = ["Primary / Wholesale", "Secondary / Retail", "KAM", "MDSR"];

export default function PrincipalKpisPage() {
  const [data, setData] = useState<MarsData | null>(null);
  const [period, setPeriod] = useState<number | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [timeMode, setTimeMode] = useState<"FISCAL" | "MONTH">("FISCAL");
  const [jbpData, setJbpData] = useState<JbpData | null>(null);
  const [slide, setSlide] = useState<"overview" | "commercial" | "productivity" | "rtm" | "jbp">("overview");
  const [commercialSlide, setCommercialSlide] = useState("Primary / Wholesale");
  const [filters, setFilters] = useState<Record<FilterKey, string>>({ sellerType: "", employeeGroup: "", location: "", teamLeader: "", fsr: "" });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [principal, setPrincipal] = useState<string | null>(null);
  const [principalOptions, setPrincipalOptions] = useState<string[]>([]);
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "error">("loading");
  const [unileverData, setUnileverData] = useState<UnileverData | null>(null);
  const [unileverState, setUnileverState] = useState<"loading" | "ready" | "error">("loading");
  const [unileverMonth, setUnileverMonth] = useState<string | null>(null);
  const [unileverDistributor, setUnileverDistributor] = useState("");
  const [unileverPjp, setUnileverPjp] = useState("");

  // Which principal(s) this user is scoped to — resolved once; the page then
  // fetches that principal's own KPI data below.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/principal-kpis/principals", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Unable to load available principals."); return response.json() as Promise<{ principals: string[] }>; })
      .then(({ principals }) => {
        if (cancelled) return;
        setPrincipalOptions(principals);
        setPrincipal((current) => current ?? principals[0] ?? null);
        setOptionsState("ready");
      })
      .catch(() => { if (!cancelled) setOptionsState("error"); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!principal || principal === UNILEVER_PRINCIPAL) return;
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("principal", principal);
    if (period) params.set("period", String(period));
    params.set("mode", timeMode);
    if (month) params.set("month", month);
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    Promise.all([
      fetch(`/api/principal-kpis/mars?${params}`, { cache: "no-store" }).then(async (response) => { if (!response.ok) throw new Error("Unable to load Principal KPI data."); return response.json() as Promise<MarsData>; }),
      fetch(`/api/principal-kpis/mars/jbp?${params}`, { cache: "no-store" }).then(async (response) => response.ok ? response.json() as Promise<JbpData> : { available: false } as JbpData),
    ])
      .then(([body, jbp]) => { if (!cancelled) { setData(body); setJbpData(jbp); setState("ready"); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [principal, period, month, timeMode, filters]);

  useEffect(() => {
    if (principal !== UNILEVER_PRINCIPAL) return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (unileverMonth) params.set("month", unileverMonth);
    if (unileverDistributor) params.set("distributor", unileverDistributor);
    fetch(`/api/principal-kpis/unilever?${params}`, { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Unable to load Unilever KPI data."); return response.json() as Promise<UnileverData>; })
      .then((body) => { if (!cancelled) { setUnileverData(body); setUnileverMonth((current) => current ?? body.month); setUnileverState("ready"); } })
      .catch(() => { if (!cancelled) setUnileverState("error"); });
    return () => { cancelled = true; };
  }, [principal, unileverMonth, unileverDistributor]);

  if (optionsState === "loading") return <FullPageSpinner label="Loading Principal KPIs..." />;
  if (optionsState === "error") return <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="Couldn't load Principal KPIs" description="Try refreshing the page." />;
  if (principalOptions.length === 0) return <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="No Principal KPI data available yet" description="Nothing has been imported for a principal you're assigned to. Ask your administrator if you expect to see data here." />;

  if (principal === UNILEVER_PRINCIPAL) {
    const cards = (unileverData?.cards ?? []).filter((card) => (!unileverDistributor || card.distributor === unileverDistributor) && (!unileverPjp || card.pjp === unileverPjp));
    const pjpOptions = Array.from(new Set((unileverData?.cards ?? []).map((card) => card.pjp))).sort();
    return <div className="flex flex-col gap-6">
      <SectionCard title="Principal KPI workspace" action={<span className="text-xs text-muted">Computed live from the synced Centegy Sales &amp; Returns data — see /admin/unilever-kpis to set PJP sales targets and the assortment basket.</span>}>
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-xs font-medium text-muted">Principal<select value={principal ?? ""} onChange={(event) => setPrincipal(event.target.value)} disabled={principalOptions.length <= 1} className="h-10 min-w-40 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground disabled:opacity-100">{principalOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium text-muted">Month<input type="month" value={unileverMonth ?? ""} onChange={(event) => setUnileverMonth(event.target.value)} className="h-10 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground" /></label>
          <label className="grid gap-1 text-xs font-medium text-muted">Branch<select value={unileverDistributor} onChange={(event) => { setUnileverDistributor(event.target.value); setUnileverPjp(""); }} className="h-10 min-w-36 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground"><option value="">All</option>{(unileverData?.distributorOptions ?? []).map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-medium text-muted">PJP / route<select value={unileverPjp} onChange={(event) => setUnileverPjp(event.target.value)} className="h-10 min-w-40 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground"><option value="">All</option>{pjpOptions.map((pjp) => <option value={pjp} key={pjp}>{pjp}</option>)}</select></label>
        </div>
      </SectionCard>

      {unileverState === "loading" && !unileverData ? <FullPageSpinner label="Loading Unilever KPIs..." /> : null}
      {unileverState === "error" ? <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="Couldn't load Unilever KPIs" description="Try refreshing the page." /> : null}
      {unileverState === "ready" && cards.length === 0 ? <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="No Unilever activity for this selection" description="No Centegy Sales & Returns data has synced for this month/branch/PJP yet." /> : null}
      {cards.length > 0 ? <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">{cards.map((card) => <UnileverProductivityCard card={card} key={`${card.distributor}-${card.pjp}`} />)}</div> : null}
    </div>;
  }

  if (state === "loading" && !data) return <FullPageSpinner label="Loading Principal KPIs..." />;
  if (state === "error" || !data) return <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="Couldn't load Principal KPIs" description="Try refreshing the page. If the issue persists, the reference import may need attention." />;
  if (!data.available || !data.summary) return <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title={`${principal} KPI data is being prepared`} description="The fiscal calendar, targets, roster and sales ledger for this principal are not loaded yet." />;

  const { summary, periods = [], selectedPeriod = 1, fiscalYear = "", priorYear = "", byPeriod = [], bySeller = [], byBrand = [], rtmPerformance = [], rtmUniverse = [], locationScorecards = [], repProductivityScorecards = [], source, asOf, filterOptions } = data;
  const selected = periods.find((item) => item.periodNo === selectedPeriod);
  const periodLabel = selected ? `${selected.periodKey} | ${new Date(selected.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - ${new Date(selected.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : `P${String(selectedPeriod).padStart(2, "0")}`;
  const sellerData = bySeller.map((item, index) => ({ ...item, fill: CHART_COLORS[index % CHART_COLORS.length] }));
  const rows = locationScorecards.filter((row) => row.stream === commercialSlide);
  const ratio = (numerator: number, denominator: number) => denominator > 0 ? formatPercent((numerator / denominator) * 100) : "-";
  const growth = (current: number, prior: number) => prior > 0 ? formatPercent(((current / prior) - 1) * 100) : "-";
  const calendarMonths = Array.from(new Set(periods.flatMap((item) => [item.startDate.slice(0, 7), item.endDate.slice(0, 7)]))).sort();
  const activeMonth = month ?? data.selectedMonth ?? calendarMonths.at(-1) ?? "";
  const selectedTimeLabel = timeMode === "MONTH" ? new Date(`${activeMonth}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }) : periodLabel;

  return <div className="flex flex-col gap-6">
    <SectionCard title="Principal KPI workspace" action={<span className="text-xs text-muted">Each principal uses its own imported fiscal calendar and targets.</span>}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-xs font-medium text-muted">Principal<select value={principal ?? ""} onChange={(event) => setPrincipal(event.target.value)} disabled={principalOptions.length <= 1} className="h-10 min-w-40 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground disabled:opacity-100">{principalOptions.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
        <div className="grid gap-1 text-xs font-medium text-muted"><span>Time view</span><div className="flex rounded-xl border border-border bg-background-elevated p-1"><button type="button" onClick={() => setTimeMode("FISCAL")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${timeMode === "FISCAL" ? "bg-brand-navy text-white" : "text-muted"}`}>Mars periods</button><button type="button" onClick={() => setTimeMode("MONTH")} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${timeMode === "MONTH" ? "bg-brand-navy text-white" : "text-muted"}`}>Calendar months</button></div></div>
        {timeMode === "FISCAL" ? <label className="grid gap-1 text-xs font-medium text-muted">Fiscal period<select value={selectedPeriod} onChange={(event) => setPeriod(Number(event.target.value))} className="h-10 min-w-60 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground">{periods.map((item) => <option value={item.periodNo} key={item.periodKey}>{item.periodKey} | {new Date(item.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} - {new Date(item.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</option>)}</select></label> : <label className="grid gap-1 text-xs font-medium text-muted">Calendar month<select value={activeMonth} onChange={(event) => setMonth(event.target.value)} className="h-10 min-w-52 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground">{calendarMonths.map((value) => <option value={value} key={value}>{new Date(`${value}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</option>)}</select></label>}
        {([ ["sellerType", "Sales stream", filterOptions?.sellerTypes ?? []], ["employeeGroup", "Employee group", filterOptions?.employeeGroups ?? []], ["location", "Location / sub-region", filterOptions?.locations ?? []], ["teamLeader", "Team leader", filterOptions?.teamLeaders ?? []], ["fsr", "FSR", filterOptions?.fsrs ?? []] ] as Array<[FilterKey, string, string[]]>).map(([key, label, options]) => <label className="grid gap-1 text-xs font-medium text-muted" key={key}>{label}<select value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))} className="h-10 min-w-40 rounded-xl border border-border bg-background-elevated px-3 text-sm font-semibold text-foreground"><option value="">All</option>{options.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>)}
        {Object.values(filters).some(Boolean) ? <button type="button" onClick={() => setFilters({ sellerType: "", employeeGroup: "", location: "", teamLeader: "", fsr: "" })} className="h-10 rounded-xl border border-border px-3 text-sm font-semibold text-muted hover:bg-background-elevated">Clear filters</button> : null}
      </div>
      <p className="mt-3 text-sm text-muted">{timeMode === "MONTH" ? <>Calendar-month actuals for <span className="font-semibold text-foreground">{selectedTimeLabel}</span>; targets are weighted by the actual days each Mars period contributes to the month.</> : <>FY {fiscalYear} through <span className="font-semibold text-foreground">{periodLabel}</span>, compared with FY {priorYear} at the equivalent fiscal day.</>} {source === "PINE" ? <span className="font-medium text-emerald-700">Live Pine actuals{asOf ? ` as of ${new Date(asOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.</span> : "Workbook baseline while live Pine is being verified."}</p>
    </SectionCard>

    <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-2" role="tablist" aria-label="Mars KPI views">{([ ["overview", "Overview"], ["commercial", "Commercial scorecards"], ["productivity", "Productivity & mix"], ["rtm", "RTM"], ["jbp", "JBP customers"] ] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={slide === key} onClick={() => setSlide(key)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${slide === key ? "bg-brand-navy text-white" : "text-muted hover:bg-background-elevated hover:text-foreground"}`}>{label}</button>)}</div>

    {slide === "overview" ? <><KpiGrid>
      <KpiCard accent="revenue" label={timeMode === "MONTH" ? "Net calendar SSU" : "Net PTD SSU"} value={<AnimatedValue value={summary.current.ptdSsu} format={formatNumber} />} sublabel={`Returns: ${formatNumber(summary.current.ptdReturns)}`} delta={summary.ptdGrowth === null ? undefined : { value: summary.ptdGrowth, caption: timeMode === "MONTH" ? "vs prior calendar year" : `vs FY ${priorYear}` }} />
      <KpiCard accent="coverage" label={timeMode === "MONTH" ? "Calendar SSU achievement" : "PTD SSU achievement"} value={<AnimatedValue value={summary.ptdAchievement ?? 0} format={(value) => value === 0 && summary.ptdAchievement === null ? "-" : formatPercent(value)} />} sublabel={`Target: ${formatNumber(summary.target.ptdSsuTarget)}`} />
      <KpiCard accent="coverage" label={timeMode === "MONTH" ? "Coverage (calendar month)" : "Coverage (PTD)"} value={<AnimatedValue value={summary.ptdCoverage ?? 0} format={(value) => value === 0 && summary.ptdCoverage === null ? "-" : formatPercent(value)} />} sublabel={`${formatNumber(summary.current.ptdOutlets)} visited`} />
      <KpiCard accent="growth" label={timeMode === "MONTH" ? "Productive outlets (month)" : "Productive outlets (PTD)"} value={<AnimatedValue value={summary.current.ptdProductive} format={formatNumber} />} sublabel={`Strike: ${summary.ptdStrikeRate === null ? "-" : formatPercent(summary.ptdStrikeRate)}`} />
      <KpiCard accent="quarter" label={timeMode === "MONTH" ? "Conversion rate (month)" : "Conversion rate (PTD)"} value={<AnimatedValue value={summary.ptdConversion ?? 0} format={(value) => value === 0 && summary.ptdConversion === null ? "-" : formatPercent(value)} />} />
      {timeMode === "MONTH" ? <><KpiCard accent="revenue" label="Calendar-month revenue" value={<AnimatedValue value={summary.current.ptdRevenue} format={formatCompact} />} /><KpiCard accent="growth" label="Prior calendar-year SSU" value={<AnimatedValue value={summary.prior?.ptdSsu ?? 0} format={formatNumber} />} /></> : <><KpiCard accent="growth" label="Fiscal YTD SSU" value={<AnimatedValue value={summary.current.ytdSsu} format={formatNumber} />} delta={summary.ytdGrowth === null ? undefined : { value: summary.ytdGrowth, caption: `vs FY ${priorYear}` }} /><KpiCard accent="quarter" label="Fiscal YTD achievement" value={<AnimatedValue value={summary.ytdAchievement ?? 0} format={(value) => value === 0 && summary.ytdAchievement === null ? "-" : formatPercent(value)} />} sublabel={`Target: ${formatNumber(summary.target.ytdSsuTarget)}`} /><KpiCard accent="revenue" label="Fiscal YTD revenue" value={<AnimatedValue value={summary.current.ytdRevenue} format={formatCompact} />} /></>}
    </KpiGrid><ChartGrid>
      <SectionCard title="Fiscal period trend - SSU"><ResponsiveContainer width="100%" height={300}><LineChart data={byPeriod} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} /><XAxis dataKey="periodKey" stroke={CHART_AXIS_COLOR} fontSize={11} /><YAxis stroke={CHART_AXIS_COLOR} fontSize={11} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatNumber(Number(value))} /><Line dataKey="ssu" name="SSU" type="monotone" stroke={CHART_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></SectionCard>
      <SectionCard title="Fiscal YTD SSU by seller type"><ResponsiveContainer width="100%" height={300}><BarChart data={sellerData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}><CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} /><XAxis type="number" stroke={CHART_AXIS_COLOR} fontSize={11} /><YAxis type="category" dataKey="name" width={95} stroke={CHART_AXIS_COLOR} fontSize={11} /><Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value) => formatNumber(Number(value))} /><Bar dataKey="ytdSsu" name="YTD SSU" radius={[0, 6, 6, 0]}>{sellerData.map((item, index) => <Cell key={`${item.name}-${index}`} fill={item.fill} />)}</Bar></BarChart></ResponsiveContainer></SectionCard>
    </ChartGrid></> : null}

    {slide === "commercial" ? <SectionCard title="Commercial scorecards by location" action={<span className="text-xs text-muted">Primary = Wholesale; Secondary = Retail. PTD targets are paced to fiscal days elapsed.</span>}>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Commercial scorecard slides">{commercialStreams.map((stream) => <button key={stream} type="button" role="tab" aria-selected={commercialSlide === stream} onClick={() => setCommercialSlide(stream)} className={`rounded-lg px-3 py-2 text-sm font-semibold ${commercialSlide === stream ? "bg-brand-navy text-white" : "border border-border text-muted hover:bg-background-elevated"}`}>{stream}</button>)}</div>
      <div className="overflow-hidden rounded-xl border border-border"><div className="border-b border-border bg-background-elevated px-4 py-3 text-sm font-bold text-foreground">{commercialSlide} performance - {selected?.periodKey ?? `P${String(selectedPeriod).padStart(2, "0")}`}</div><TableWrap><Thead><Th>Location / sub-region</Th><Th align="right">Full target</Th><Th align="right">PTD target</Th><Th align="right">SSU sold PTD</Th><Th align="right">vs target</Th><Th align="right">SSU sold LYSP</Th><Th align="right">vs LYSP</Th><Th align="right">Universe</Th><Th align="right">Visits PTD</Th><Th align="right">Visits LYSP</Th><Th align="right">Coverage</Th><Th align="right">Coverage growth</Th><Th align="right">Productive PTD</Th><Th align="right">Productive LYSP</Th><Th align="right">Strike</Th><Th align="right">Conversion</Th><Th align="right">Productive growth</Th><Th align="right">L.P.P.C</Th><Th align="right">Drop size</Th></Thead><tbody>{rows.map((row) => <tr key={`${commercialSlide}-${row.location}`}><Td>{row.location}</Td><Td align="right">{formatNumber(row.fullSsuTarget)}</Td><Td align="right">{formatNumber(row.ptdSsuTarget)}</Td><Td align="right">{formatNumber(row.ptdSsu)}</Td><Td align="right">{ratio(row.ptdSsu, row.ptdSsuTarget)}</Td><Td align="right">{formatNumber(row.lyspSsu)}</Td><Td align="right">{growth(row.ptdSsu, row.lyspSsu)}</Td><Td align="right">{formatNumber(row.universeTarget)}</Td><Td align="right">{formatNumber(row.visits)}</Td><Td align="right">{formatNumber(row.lyspVisits)}</Td><Td align="right">{ratio(row.visits, row.universeTarget)}</Td><Td align="right">{growth(row.visits, row.lyspVisits)}</Td><Td align="right">{formatNumber(row.productive)}</Td><Td align="right">{formatNumber(row.lyspProductive)}</Td><Td align="right">{ratio(row.productive, row.visits)}</Td><Td align="right">{ratio(row.productive, row.universeTarget)}</Td><Td align="right">{growth(row.productive, row.lyspProductive)}</Td><Td align="right">{row.lppc === null ? "-" : row.lppc.toLocaleString("en-US", { maximumFractionDigits: 1 })}</Td><Td align="right">{row.dropSize === null ? "-" : row.dropSize.toLocaleString("en-US", { maximumFractionDigits: 1 })}</Td></tr>)}</tbody></TableWrap></div>
    </SectionCard> : null}

    {slide === "productivity" ? <><SectionCard title="Productive target - rep scorecard" action={<span className="text-xs text-muted">SKU-level productive outlet targets from the Mars Productive Report, reconciled to positive non-return customer/SKU lines.</span>}><TableWrap><Thead><Th>Location</Th><Th>FSR / employee</Th><Th align="right">Productive target</Th><Th align="right">Actual productive</Th><Th align="right">Achievement</Th></Thead><tbody>{repProductivityScorecards.map((row) => <tr key={row.employeeCode}><Td>{row.location}</Td><Td>{row.employeeName} <span className="text-xs text-muted">({row.employeeCode})</span></Td><Td align="right">{formatNumber(row.target)}</Td><Td align="right">{formatNumber(row.productive)}</Td><Td align="right">{ratio(row.productive, row.target)}</Td></tr>)}</tbody></TableWrap></SectionCard><ChartGrid>
      <SectionCard title="Brand / product mix - Fiscal YTD"><TableWrap><Thead><Th>Brand</Th><Th align="right">SSU</Th><Th align="right">Revenue</Th></Thead><tbody>{byBrand.map((row) => <tr key={row.name}><Td>{row.name}</Td><Td align="right">{formatNumber(row.ssu)}</Td><Td align="right">{formatCompact(row.revenue)}</Td></tr>)}</tbody></TableWrap></SectionCard>
      <SectionCard title="Wholesale, retail, KAM and MDSR performance"><TableWrap><Thead><Th>Sales stream</Th><Th align="right">Net PTD SSU</Th><Th align="right">YTD SSU</Th><Th align="right">PTD visits</Th><Th align="right">Productive</Th><Th align="right">Strike rate</Th><Th align="right">PTD revenue</Th></Thead><tbody>{bySeller.map((row) => <tr key={row.name}><Td>{row.name}</Td><Td align="right">{formatNumber(row.ptdSsu)}</Td><Td align="right">{formatNumber(row.ytdSsu)}</Td><Td align="right">{formatNumber(row.ptdVisits)}</Td><Td align="right">{formatNumber(row.ptdProductive)}</Td><Td align="right">{ratio(row.ptdProductive, row.ptdVisits)}</Td><Td align="right">{formatCompact(row.ptdRevenue)}</Td></tr>)}</tbody></TableWrap></SectionCard>
    </ChartGrid></> : null}

    {slide === "rtm" ? <SectionCard title="RTM performance" action={<span className="text-xs text-muted">Absolute customer universe from the Mars RTM list; activity is shown for the selected fiscal period.</span>}><TableWrap><Thead><Th>RTM classification</Th><Th align="right">Universe</Th><Th align="right">PTD visits</Th><Th align="right">Productive</Th><Th align="right">Strike rate</Th><Th align="right">Net PTD SSU</Th><Th align="right">PTD revenue</Th></Thead><tbody>{rtmPerformance.map((row) => <tr key={row.name}><Td>{row.name}</Td><Td align="right">{formatNumber(rtmUniverse.find((item) => item.name === row.name)?.customers ?? 0)}</Td><Td align="right">{formatNumber(row.ptdVisits)}</Td><Td align="right">{formatNumber(row.ptdProductive)}</Td><Td align="right">{ratio(row.ptdProductive, row.ptdVisits)}</Td><Td align="right">{formatNumber(row.ptdSsu)}</Td><Td align="right">{formatCompact(row.ptdRevenue)}</Td></tr>)}</tbody></TableWrap></SectionCard> : null}

    {slide === "jbp" ? !jbpData?.available ? <EmptyState icon={<TargetArrow20Regular className="h-10 w-10" />} title="JBP targets have not been imported" description="Run the Mars importer with the JBP Customer Performance vs Target workbook to load its customer, category, tier and period targets." /> : <><KpiGrid>
      <KpiCard accent="revenue" label="JBP actual cases" value={<AnimatedValue value={jbpData.overall?.cases ?? 0} format={formatNumber} />} sublabel={`Target: ${formatNumber(jbpData.overall?.casesTarget ?? 0)}`} />
      <KpiCard accent="coverage" label="JBP cases achievement" value={<AnimatedValue value={jbpData.overall?.casesAchievement ?? 0} format={(value) => jbpData.overall?.casesAchievement === null ? "-" : formatPercent(value)} />} />
      <KpiCard accent="growth" label="JBP actual SSU" value={<AnimatedValue value={jbpData.overall?.ssu ?? 0} format={formatNumber} />} sublabel={`Target: ${formatNumber(jbpData.overall?.ssuTarget ?? 0)}`} />
      <KpiCard accent="quarter" label="JBP SSU achievement" value={<AnimatedValue value={jbpData.overall?.ssuAchievement ?? 0} format={(value) => jbpData.overall?.ssuAchievement === null ? "-" : formatPercent(value)} />} />
    </KpiGrid><SectionCard title={`JBP category performance — ${jbpData.windowLabel ?? selectedTimeLabel}`} action={<span className="text-xs text-muted">Matches the workbook’s customer × category target structure. Overall Target compares all product categories for each targeted customer.</span>}><TableWrap><Thead><Th>Category</Th><Th align="right">Cases target</Th><Th align="right">Cases actual</Th><Th align="right">Cases achievement</Th><Th align="right">SSU target</Th><Th align="right">SSU actual</Th><Th align="right">SSU achievement</Th></Thead><tbody>{(jbpData.categories ?? []).map((row) => <tr key={row.category}><Td>{row.category}</Td><Td align="right">{formatNumber(row.casesTarget)}</Td><Td align="right">{formatNumber(row.cases)}</Td><Td align="right">{row.casesAchievement === null ? "-" : formatPercent(row.casesAchievement)}</Td><Td align="right">{formatNumber(row.ssuTarget)}</Td><Td align="right">{formatNumber(row.ssu)}</Td><Td align="right">{row.ssuAchievement === null ? "-" : formatPercent(row.ssuAchievement)}</Td></tr>)}</tbody></TableWrap></SectionCard><SectionCard title="JBP customer performance"><TableWrap><Thead><Th>Tier</Th><Th>Area</Th><Th>Customer</Th><Th>Category</Th><Th align="right">Cases target</Th><Th align="right">Cases actual</Th><Th align="right">Cases achievement</Th><Th align="right">SSU target</Th><Th align="right">SSU actual</Th><Th align="right">SSU achievement</Th></Thead><tbody>{(jbpData.rows ?? []).map((row) => <tr key={`${row.customerId}-${row.category}`}><Td>{row.tier ?? "-"}</Td><Td>{row.area ?? "-"}</Td><Td>{row.customerName ?? row.customerId}</Td><Td>{row.category}</Td><Td align="right">{formatNumber(row.casesTarget)}</Td><Td align="right">{formatNumber(row.cases)}</Td><Td align="right">{row.casesAchievement === null ? "-" : formatPercent(row.casesAchievement)}</Td><Td align="right">{formatNumber(row.ssuTarget)}</Td><Td align="right">{formatNumber(row.ssu)}</Td><Td align="right">{row.ssuAchievement === null ? "-" : formatPercent(row.ssuAchievement)}</Td></tr>)}</tbody></TableWrap></SectionCard></> : null}
  </div>;
}
