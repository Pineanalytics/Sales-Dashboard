"use client";

import { useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import type { ViewProps } from "./types";
import { KpiCard } from "@/components/ui/KpiCard";
import { KpiGrid, SectionCard, ChartGrid } from "@/components/ui/KpiGrid";
import { Badge } from "@/components/ui/Badge";
import { AnimatedValue } from "@/components/ui/AnimatedValue";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatNumber, formatPercent, productivityTier, tierBarColor } from "@/lib/format";
import {
  CANONICAL_MONTHS,
  getAvailableMonths,
  resolvePeriodMonths,
  summarizeCoverageForPeriod,
  summarizeCoverageTargetsForPeriod,
  summarizeCoverageByRep,
  summarizeCoverageByRepAcrossPrincipals,
  type RoleCategory,
} from "@/lib/timeIntelligence";
import { CHART_GRID_COLOR, CHART_AXIS_COLOR, tooltipContentStyle, tooltipLabelStyle } from "@/components/charts/theme";

const TOP_N_REPS = 12;

const ROLE_LABEL: Record<RoleCategory, string> = { primary: "Primary", secondary: "Secondary", other: "Other" };

export function CoverageView({ dataset, selectedPrincipalKey, period }: ViewProps) {
  const [selectedRole, setSelectedRole] = useState<RoleCategory>("primary");
  const [selectedRep, setSelectedRep] = useState<string | null>(null);
  const roleLabel = ROLE_LABEL[selectedRole];

  const currentSummary = summarizeCoverageForPeriod(dataset, period, selectedPrincipalKey, selectedRole);
  const targetSummary = summarizeCoverageTargetsForPeriod(dataset, period, selectedPrincipalKey);
  const targetsApply = selectedRole === "primary";
  const coverageAchievementPct = targetsApply && targetSummary.coverageTarget ? Math.round((currentSummary.coverage / targetSummary.coverageTarget) * 1000) / 10 : null;
  const productivityVariancePct = targetsApply && targetSummary.productivityTarget !== null ? Math.round((currentSummary.productivityPct - targetSummary.productivityTarget) * 10) / 10 : null;
  const reps = summarizeCoverageByRep(dataset, period, selectedPrincipalKey, selectedRole).sort((a, b) => b.coverage - a.coverage);

  const monthsThisYear = getAvailableMonths(dataset, period.year);
  const monthlyTrend = CANONICAL_MONTHS.filter((m) => monthsThisYear.includes(m)).map((month) => {
    const s = summarizeCoverageForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey, selectedRole);
    const targets = summarizeCoverageTargetsForPeriod(dataset, { kind: "MONTH", year: period.year, month }, selectedPrincipalKey);
    return {
      month,
      coverage: s.coverage,
      productive: s.productiveCalls,
      productivityPct: s.productivityPct,
      coverageTarget: targetsApply ? targets.coverageTarget : null,
      productivityTarget: targetsApply ? targets.productivityTarget : null,
    };
  });

  const avgCoverage = monthlyTrend.length ? Math.round(monthlyTrend.reduce((s, r) => s + r.coverage, 0) / monthlyTrend.length) : 0;
  const avgProductivity = monthlyTrend.length
    ? Math.round((monthlyTrend.reduce((s, r) => s + r.productivityPct, 0) / monthlyTrend.length) * 10) / 10
    : 0;

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
      const productivityPct = coverage > 0 ? Math.round((productiveCalls / coverage) * 1000) / 10 : 0;
      return {
        name: p.name,
        coverage,
        productiveCalls,
        productivityPct,
        coverageTarget: targets.coverageTarget,
        productivityTarget: targets.productivityTarget,
      };
    })
    .sort((a, b) => b.coverage - a.coverage);

  const repByPrincipal = selectedRep ? summarizeCoverageByRepAcrossPrincipals(dataset, period, selectedRep) : [];

  const productivityChartData = selectedRep
    ? repByPrincipal.map((p) => ({ name: p.principal.split("-")[0], value: p.productivityPct, fill: tierBarColor[productivityTier(p.productivityPct)] }))
    : selectedPrincipalKey
      ? reps.slice(0, TOP_N_REPS).map((r) => ({ name: r.employeeName, value: r.productivityPct, fill: tierBarColor[productivityTier(r.productivityPct)] }))
      : principalBars.map((p) => ({
          name: p.name,
          value: p.coverage > 0 ? Math.round((p.productiveCalls / p.coverage) * 1000) / 10 : 0,
          fill: tierBarColor[productivityTier(p.coverage > 0 ? (p.productiveCalls / p.coverage) * 100 : 0)],
        }));

  const chartTitle = selectedRep
    ? `${selectedRep} — Productivity by Principal`
    : selectedPrincipalKey
      ? `Productivity % by Rep (top ${Math.min(TOP_N_REPS, reps.length)})`
      : "Productivity % by Principal";

  const principalTargetComparison = principalBars.filter((row) => row.coverageTarget !== null || row.productivityTarget !== null);

  function handleSelectRole(role: RoleCategory) {
    setSelectedRole(role);
    setSelectedRep(null);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Sales Role</span>
        <div className="flex rounded-full bg-background-elevated p-0.5">
          {(["primary", "secondary"] as const).map((role) => (
            <button
              key={role}
              onClick={() => handleSelectRole(role)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-300 ${
                selectedRole === role
                  ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                  : "text-muted-strong hover:text-primary-blue"
              }`}
            >
              {ROLE_LABEL[role]}
            </button>
          ))}
        </div>
      </div>

      <KpiGrid>
        <KpiCard accent="coverage" label={`${period.kind} Coverage (${roleLabel})`} value={<AnimatedValue value={currentSummary.coverage} format={formatNumber} />} />
        <KpiCard accent="coverage" label={`${period.kind} Productive (${roleLabel})`} value={<AnimatedValue value={currentSummary.productiveCalls} format={formatNumber} />} />
        <KpiCard
          accent="coverage"
          label={`${period.kind} Productivity (${roleLabel})`}
          value={<AnimatedValue value={currentSummary.productivityPct} format={formatPercent} />}
        />
        <KpiCard accent="coverage" label={`${period.year} Monthly Avg Coverage`} value={<AnimatedValue value={avgCoverage} format={formatNumber} />} />
        <KpiCard accent="coverage" label={`${period.year} Monthly Avg Productivity`} value={<AnimatedValue value={avgProductivity} format={formatPercent} />} />
        {targetsApply ? <KpiCard accent="mission" label="Coverage Target" value={targetSummary.coverageTarget === null ? "Not set" : <AnimatedValue value={targetSummary.coverageTarget} format={formatNumber} />} size={targetSummary.coverageTarget === null ? "md" : "lg"} sublabel={targetSummary.monthsTargeted ? `${targetSummary.monthsTargeted} month(s) targeted` : undefined} /> : null}
        {targetsApply ? <KpiCard accent="mission" label="Coverage Achievement" value={coverageAchievementPct === null ? "—" : <AnimatedValue value={coverageAchievementPct} format={formatPercent} />} size={coverageAchievementPct === null ? "md" : "lg"} delta={coverageAchievementPct === null ? undefined : { value: coverageAchievementPct - 100, caption: "vs target" }} /> : null}
        {targetsApply ? <KpiCard accent="mission" label="Productivity Target" value={targetSummary.productivityTarget === null ? "Not set" : <AnimatedValue value={targetSummary.productivityTarget} format={formatPercent} />} size={targetSummary.productivityTarget === null ? "md" : "lg"} /> : null}
        {targetsApply ? <KpiCard accent="mission" label="Productivity Variance" value={productivityVariancePct === null ? "—" : `${productivityVariancePct > 0 ? "+" : ""}${productivityVariancePct.toFixed(1)} pp`} size="md" delta={productivityVariancePct === null ? undefined : { value: productivityVariancePct, caption: "vs target", format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(1)} pp` }} /> : null}
      </KpiGrid>

      <ChartGrid>
        <SectionCard title={`${period.year} Coverage vs Productive Outlets (${roleLabel})`}>
          <ResponsiveContainer width="100%" height={320}>
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

        <SectionCard
          title={chartTitle}
          action={
            selectedRep ? (
              <button
                onClick={() => setSelectedRep(null)}
                className="text-xs font-semibold text-accent-blue hover:underline"
              >
                Clear rep
              </button>
            ) : null
          }
        >
          <ResponsiveContainer width="100%" height={320}>
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

      {targetsApply && !selectedRep ? (
        <ChartGrid>
          <SectionCard title="Productivity vs Target by Principal">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={principalTargetComparison} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} unit="%" />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(v) => `${Number(v).toFixed(1)}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="productivityPct" name="Actual" fill="var(--primary-blue)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="productivityTarget" name="Target" fill="var(--accent-green)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
          <SectionCard title="Coverage vs Target by Principal">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={principalTargetComparison} margin={{ top: 8, right: 8, left: 0, bottom: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis dataKey="name" stroke={CHART_AXIS_COLOR} fontSize={11} interval={0} angle={-35} textAnchor="end" height={60} />
                <YAxis stroke={CHART_AXIS_COLOR} fontSize={11} />
                <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="coverage" name="Actual" fill="var(--primary-blue)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="coverageTarget" name="Target" fill="var(--accent-green)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </SectionCard>
        </ChartGrid>
      ) : null}

      {targetsApply && !selectedRep ? (
        <SectionCard title="Principal Target Comparison" action={<span className="text-xs text-muted">Primary Sales only · zero targets are excluded</span>}>
          <TableWrap>
            <Thead>
              <Th>Principal</Th><Th align="right">Coverage</Th><Th align="right">Target</Th><Th align="center">Achievement</Th><Th align="center">Productivity</Th><Th align="center">Target</Th><Th align="center">Variance</Th>
            </Thead>
            <tbody>
              {principalTargetComparison.map((row) => {
                const coverageAchievement = row.coverageTarget ? (row.coverage / row.coverageTarget) * 100 : null;
                const productivityVariance = row.productivityTarget === null ? null : row.productivityPct - row.productivityTarget;
                return <tr key={row.name}><Td>{row.name}</Td><Td align="right">{formatNumber(row.coverage)}</Td><Td align="right">{row.coverageTarget === null ? "—" : formatNumber(row.coverageTarget)}</Td><Td align="center"><Badge tier={coverageAchievement === null ? "neutral" : coverageAchievement >= 100 ? "good" : coverageAchievement >= 80 ? "warn" : "bad"}>{coverageAchievement === null ? "—" : `${coverageAchievement.toFixed(1)}%`}</Badge></Td><Td align="center"><Badge tier={productivityTier(row.productivityPct)}>{row.productivityPct.toFixed(1)}%</Badge></Td><Td align="center">{row.productivityTarget === null ? "—" : `${row.productivityTarget.toFixed(1)}%`}</Td><Td align="center"><Badge tier={productivityVariance === null ? "neutral" : productivityVariance >= 0 ? "good" : "bad"}>{productivityVariance === null ? "—" : `${productivityVariance > 0 ? "+" : ""}${productivityVariance.toFixed(1)} pp`}</Badge></Td></tr>;
              })}
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : null}

      <SectionCard
        title={`Rep Drill-Down (${roleLabel}) — ${period.kind} ${period.year}`}
        action={<span className="text-xs text-muted">Click a row to see that rep across every principal they serve</span>}
      >
        <TableWrap>
          <Thead>
            <Th>Employee</Th>
            <Th>Role</Th>
            <Th align="right">Outlets Covered</Th>
            <Th align="right">Productive Outlets</Th>
            <Th align="center">Productivity %</Th>
          </Thead>
          <tbody>
            {reps.map((r) => (
              <tr
                key={r.employeeName}
                onClick={() => setSelectedRep(selectedRep === r.employeeName ? null : r.employeeName)}
                className={`cursor-pointer transition-colors duration-150 hover:bg-accent-blue-soft ${
                  selectedRep === r.employeeName ? "bg-accent-blue-soft" : ""
                }`}
              >
                <Td>{r.employeeName}</Td>
                <Td>{r.salesRole}</Td>
                <Td align="right">{formatNumber(r.coverage)}</Td>
                <Td align="right">{formatNumber(r.productiveCalls)}</Td>
                <Td align="center">
                  <Badge tier={productivityTier(r.productivityPct)}>{r.productivityPct.toFixed(1)}%</Badge>
                </Td>
              </tr>
            ))}
            <TotalRow>
              <Td>Total</Td>
              <Td>—</Td>
              <Td align="right">{formatNumber(currentSummary.coverage)}</Td>
              <Td align="right">{formatNumber(currentSummary.productiveCalls)}</Td>
              <Td align="center">
                <Badge tier={productivityTier(currentSummary.productivityPct)}>{currentSummary.productivityPct.toFixed(1)}%</Badge>
              </Td>
            </TotalRow>
          </tbody>
        </TableWrap>
      </SectionCard>
    </div>
  );
}
