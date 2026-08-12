"use client";

import { useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber, formatPercent, strikeRateTier, tierBarColor } from "@/lib/format";
import {
  CANONICAL_MONTHS,
  getAvailableMonths,
  resolvePeriodMonths,
  summarizeCoverageForPeriod,
  summarizeCoverageTargetsForPeriod,
  summarizeCoverageByRep,
  type RoleCategory,
} from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const TOP_N_REPS = 12;

const ROLE_LABEL: Record<RoleCategory, string> = { primary: "Primary", secondary: "Secondary", other: "Other" };

export function CoverageView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const [selectedRole, setSelectedRole] = useState<RoleCategory>("primary");
  const [activePanel, setActivePanel] = useState<"overview" | "reps">("overview");
  const [showAllPrincipals, setShowAllPrincipals] = useState(false);
  const [showAllReps, setShowAllReps] = useState(false);
  const roleLabel = ROLE_LABEL[selectedRole];

  const currentSummary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, selectedRole);
  const targetSummary = summarizeCoverageTargetsForPeriod(dataset, period, selectedPrincipalKey);
  const targetsApply = selectedRole === "primary";
  const coverageAchievementPct = targetsApply && targetSummary.coverageTarget ? Math.round((currentSummary.coverage / targetSummary.coverageTarget) * 1000) / 10 : null;
  const productivityAchievementPct = targetsApply && targetSummary.productivityTarget
    ? Math.round((currentSummary.productiveCalls / targetSummary.productivityTarget) * 1000) / 10
    : null;
  const reps = summarizeCoverageByRep(dataset, period, selectedPrincipalKey, selectedRole).sort((a, b) => b.coverage - a.coverage);

  const monthsThisYear = getAvailableMonths(dataset, period.year);
  const monthlyTrend = CANONICAL_MONTHS.filter((m) => monthsThisYear.includes(m)).map((month) => {
    const s = summarizeCoverageForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey, selectedRole);
    const targets = summarizeCoverageTargetsForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey);
    return {
      month,
      coverage: s.coverage,
      productive: s.productiveCalls,
      strikeRatePct: s.productivityPct,
      coverageTarget: targetsApply ? targets.coverageTarget : null,
      productivityTarget: targetsApply ? targets.productivityTarget : null,
    };
  });

  const months = resolvePeriodMonths(period);
  const monthKeys = new Set(months.map((m) => `${m.year}|${m.monthIndex}`));
  const rowsInPeriod = dataset.monthlyCoverage.filter(
    (r) =>
      monthKeys.has(`${r.year}|${r.monthIndex}`) &&
      (!selectedPrincipalKey || r.principalKey === selectedPrincipalKey) &&
      r.salesRole.toLowerCase().includes(selectedRole)
  );
  // Group by principal, then by month within each principal (summing across reps in the
  // same month is fine — different reps' outlets are additive), then average across
  // months: coverage counts unique outlets, so a multi-month period must not sum them.
  const byPrincipal = new Map<string, { name: string; principalKey: string; byMonth: Map<string, { coverage: number; productiveCalls: number }> }>();
  for (const r of rowsInPeriod) {
    let p = byPrincipal.get(r.principalKey);
    if (!p) {
      p = { name: r.principal.split("-")[0], principalKey: r.principalKey, byMonth: new Map() };
      byPrincipal.set(r.principalKey, p);
    }
    const mKey = `${r.year}|${r.monthIndex}`;
    const existing = p.byMonth.get(mKey);
    if (existing) {
      existing.coverage += r.coverage;
      existing.productiveCalls += r.productiveCalls;
    } else {
      p.byMonth.set(mKey, { coverage: r.coverage, productiveCalls: r.productiveCalls });
    }
  }
  // A target without a matching coverage row is still operationally important:
  // it represents a Primary Sales principal with zero recorded activity.
  if (targetsApply) {
    for (const target of dataset.monthlyCoverageTargets ?? []) {
      if (
        !monthKeys.has(`${target.year}|${target.monthIndex}`) ||
        (selectedPrincipalKey && target.principalKey !== selectedPrincipalKey) ||
        (target.coverageTarget === null && target.productivityTarget === null) ||
        byPrincipal.has(target.principalKey)
      ) continue;
      byPrincipal.set(target.principalKey, {
        name: target.principal.split("-")[0],
        principalKey: target.principalKey,
        byMonth: new Map(),
      });
    }
  }
  const principalBars = Array.from(byPrincipal.values())
    .map((p) => {
      const monthTotals = Array.from(p.byMonth.values());
      const n = monthTotals.length;
      const targets = summarizeCoverageTargetsForPeriod(dataset, period, p.principalKey);
      const coverage = n > 0 ? Math.round(monthTotals.reduce((s, m) => s + m.coverage, 0) / n) : 0;
      const productiveCalls = n > 0 ? Math.round(monthTotals.reduce((s, m) => s + m.productiveCalls, 0) / n) : 0;
      const strikeRatePct = coverage > 0 ? Math.round((productiveCalls / coverage) * 1000) / 10 : 0;
      const coverageAchievementPct = targets.coverageTarget ? Math.round((coverage / targets.coverageTarget) * 1000) / 10 : null;
      const productivityAchievementPct = targets.productivityTarget ? Math.round((productiveCalls / targets.productivityTarget) * 1000) / 10 : null;
      return {
        name: p.name,
        coverage,
        productiveCalls,
        strikeRatePct,
        coverageTarget: targets.coverageTarget,
        productivityTarget: targets.productivityTarget,
        coverageAchievementPct,
        productivityAchievementPct,
      };
    })
    .sort((a, b) => b.coverage - a.coverage);

  const productivityChartData = selectedPrincipalKey
      ? reps.slice(0, TOP_N_REPS).map((r) => ({ name: r.employeeName, value: r.productivityPct, fill: tierBarColor[strikeRateTier(r.productivityPct)] }))
      : principalBars.map((p) => ({
          name: p.name,
          value: p.strikeRatePct,
          fill: tierBarColor[strikeRateTier(p.strikeRatePct)],
        }));

  const chartTitle = selectedPrincipalKey
      ? `Strike Rate by Rep (top ${Math.min(TOP_N_REPS, reps.length)})`
      : "Strike Rate by Principal";

  const principalTargetComparison = principalBars.filter((row) => row.coverageTarget !== null || row.productivityTarget !== null);
  const visiblePrincipalComparison = showAllPrincipals ? principalTargetComparison : principalTargetComparison.slice(0, 8);
  const visibleReps = showAllReps ? reps : reps.slice(0, TOP_N_REPS);

  function handleSelectRole(role: RoleCategory) {
    setSelectedRole(role);
    setShowAllReps(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionCard
        accent="navy"
        title="Coverage & Productivity"
        action={<span className="text-xs text-muted">Timestamp call data · Primary targets only</span>}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-strong">Track unique outlet visits, productive calls, strike rate, and target delivery.</p>
          <div className="inline-flex rounded-full bg-background-elevated p-0.5" aria-label="Sales role">
            {(["primary", "secondary"] as const).map((role) => (
              <button
                key={role}
                onClick={() => handleSelectRole(role)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all duration-300 ${
                  selectedRole === role
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:text-primary-blue"
                }`}
              >
                {ROLE_LABEL[role]} Sales
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <nav aria-label="Coverage dashboard views" className="grid grid-cols-2 gap-2">
        {([
          ["overview", "Overview", "Targets, coverage and strike rate"],
          ["reps", "Rep performance", "Rep-level coverage and productivity"],
        ] as const).map(([panel, label, description]) => (
          <button
            key={panel}
            type="button"
            onClick={() => setActivePanel(panel)}
            aria-pressed={activePanel === panel}
            className={`rounded-xl border px-4 py-3 text-left transition-all ${activePanel === panel ? "border-primary-blue bg-primary-blue text-white shadow-cyan-glow" : "border-border bg-surface text-brand-navy hover:border-secondary-blue hover:bg-accent-blue-soft"}`}
          >
            <span className="block text-sm font-bold">{label}</span>
            <span className={`mt-0.5 block text-xs ${activePanel === panel ? "text-white/80" : "text-muted"}`}>{description}</span>
          </button>
        ))}
      </nav>

      <KpiGrid>
        <KpiCard accent="coverage" label="Unique calls visited" value={<AnimatedValue value={currentSummary.coverage} format={formatNumber} />} sublabel={`${period.kind} · ${roleLabel} Sales`} />
        <KpiCard accent="coverage" label="Unique productive calls" value={<AnimatedValue value={currentSummary.productiveCalls} format={formatNumber} />} sublabel="Sale or order calls" />
        <KpiCard
          accent="coverage"
          label="Strike rate"
          value={<AnimatedValue value={currentSummary.productivityPct} format={formatPercent} />}
          sublabel="Productive ÷ visited"
        />
        {targetsApply ? <KpiCard accent="mission" label="Coverage vs target" value={coverageAchievementPct === null ? "—" : <AnimatedValue value={coverageAchievementPct} format={formatPercent} />} size={coverageAchievementPct === null ? "md" : "lg"} sublabel={targetSummary.coverageTarget === null ? "Target not set" : `Target: ${formatNumber(targetSummary.coverageTarget)}`} delta={coverageAchievementPct === null ? undefined : { value: coverageAchievementPct - 100, caption: "vs target" }} /> : null}
        {targetsApply ? <KpiCard accent="mission" label="Productivity vs target" value={productivityAchievementPct === null ? "—" : <AnimatedValue value={productivityAchievementPct} format={formatPercent} />} size={productivityAchievementPct === null ? "md" : "lg"} sublabel={targetSummary.productivityTarget === null ? "Target not set" : `Target: ${formatNumber(targetSummary.productivityTarget)}`} delta={productivityAchievementPct === null ? undefined : { value: productivityAchievementPct - 100, caption: "vs target" }} /> : null}
      </KpiGrid>

      {activePanel === "overview" ? (
      <ChartGrid>
        <SectionCard title={`${period.year} Coverage vs Productive Outlets (${roleLabel})`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={monthlyTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(0, 3)} stroke={CHART_AXIS_COLOR} fontSize={11} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="coverage" name="Coverage" stroke="var(--primary-blue)" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="productive" name="Productive" stroke="var(--accent-blue)" strokeWidth={2.5} dot={{ r: 3 }} />
              {targetsApply ? <Line type="monotone" dataKey="coverageTarget" name="Coverage Target" stroke="var(--accent-green)" strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls /> : null}
            </LineChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title={chartTitle}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={productivityChartData} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
              <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
              <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
              <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {productivityChartData.map((d, i) => (
                  <Cell key={i} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </ChartGrid>
      ) : null}

      {activePanel === "overview" && targetsApply ? (
        <SectionCard title="Principal Target Comparison" action={<span className="text-xs text-muted">Primary Sales only · zero targets are excluded</span>}>
          <TableWrap>
            <Thead>
              <Th>Principal</Th><Th align="right">Coverage</Th><Th align="right">Target</Th><Th align="center">Coverage %</Th><Th align="right">Unique Productive</Th><Th align="right">Target</Th><Th align="center">Productivity %</Th><Th align="center">Strike Rate</Th>
            </Thead>
            <tbody>
              {visiblePrincipalComparison.map((row) => {
                return <tr key={row.name}><Td>{row.name}</Td><Td align="right">{formatNumber(row.coverage)}</Td><Td align="right">{row.coverageTarget === null ? "—" : formatNumber(row.coverageTarget)}</Td><Td align="center"><Badge tier={row.coverageAchievementPct === null ? "neutral" : row.coverageAchievementPct >= 100 ? "good" : row.coverageAchievementPct >= 80 ? "warn" : "bad"}>{row.coverageAchievementPct === null ? "—" : `${row.coverageAchievementPct.toFixed(1)}%`}</Badge></Td><Td align="right">{formatNumber(row.productiveCalls)}</Td><Td align="right">{row.productivityTarget === null ? "—" : formatNumber(row.productivityTarget)}</Td><Td align="center"><Badge tier={row.productivityAchievementPct === null ? "neutral" : row.productivityAchievementPct >= 100 ? "good" : row.productivityAchievementPct >= 80 ? "warn" : "bad"}>{row.productivityAchievementPct === null ? "—" : `${row.productivityAchievementPct.toFixed(1)}%`}</Badge></Td><Td align="center"><Badge tier={strikeRateTier(row.strikeRatePct)}>{row.strikeRatePct.toFixed(1)}%</Badge></Td></tr>;
              })}
            </tbody>
          </TableWrap>
          {principalTargetComparison.length > visiblePrincipalComparison.length ? <button onClick={() => setShowAllPrincipals(true)} className="mt-3 text-xs font-semibold text-primary-blue hover:underline">Show all {principalTargetComparison.length} principals</button> : null}
          {showAllPrincipals && principalTargetComparison.length > TOP_N_REPS ? <button onClick={() => setShowAllPrincipals(false)} className="ml-4 mt-3 text-xs font-semibold text-primary-blue hover:underline">Show fewer</button> : null}
        </SectionCard>
      ) : null}

      {activePanel === "reps" ? <SectionCard
        title={`Rep Performance (${roleLabel})`}
        action={<span className="text-xs text-muted">Unique calls visited, productive calls and strike rate</span>}
      >
        <TableWrap>
          <Thead>
            <Th>Employee</Th>
            <Th>Role</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Unique Productive</Th>
            <Th align="center">Strike Rate</Th>
          </Thead>
          <tbody>
            {visibleReps.map((r) => (
              <tr key={r.employeeName}>
                <Td>{r.employeeName}</Td>
                <Td>{r.salesRole}</Td>
                <Td align="right">{formatNumber(r.coverage)}</Td>
                <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                <Td align="center">
                  <Badge tier={strikeRateTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatNumber(currentSummary.coverage)}</Td>
              <Td align="right">{formatNumber(currentSummary.productiveCalls)}</Td>
              <Td align="center">
                <Badge tier={strikeRateTier(currentSummary.productivityPct)}>{currentSummary.productivityPct.toFixed(1)}%</Badge>
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
        {reps.length > visibleReps.length ? <button onClick={() => setShowAllReps(true)} className="mt-3 text-xs font-semibold text-primary-blue hover:underline">Show all {reps.length} reps</button> : null}
        {showAllReps && reps.length > TOP_N_REPS ? <button onClick={() => setShowAllReps(false)} className="ml-4 mt-3 text-xs font-semibold text-primary-blue hover:underline">Show fewer</button> : null}
      </SectionCard> : null}
    </div>
  );
}
