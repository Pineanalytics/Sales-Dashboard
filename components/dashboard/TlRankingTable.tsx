"use client";

import { useEffect, useState } from "react";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { AchievementBadge } from "@/components/ui/Badge";
import { formatCompact } from "@/lib/format";
import type { RepRevenueInput, TlRankingResult } from "@/lib/tlRanking";

/** MTD Target vs MTD Revenue per Team Leader — the heavy Excel-derived rep-revenue
 *  aggregation (summarizeBrandCustomerByRep) already ran client-side against the
 *  Zustand-held dataset (see the caller); this component only calls the
 *  Prisma-only half (Team Leader/WeeklyTarget join) via /api/dashboard/tl-ranking. */
export function TlRankingTable({
  repRevenue,
  principalFilter,
  year,
  monthLabel,
}: {
  repRevenue: RepRevenueInput[];
  principalFilter: string | null;
  year: string;
  monthLabel: string;
}) {
  const [status, setStatus] = useState<"loading" | "idle" | "error">("loading");
  const [result, setResult] = useState<TlRankingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const res = await fetch("/api/dashboard/tl-ranking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repRevenue, principalFilter, year, monthLabel }),
          cache: "no-store",
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load TL Ranking.");
        if (!cancelled) {
          setResult(body);
          setStatus("idle");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // repRevenue is recomputed fresh each render from the dataset — stringify so the
    // effect only re-fires when its actual contents change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(repRevenue), principalFilter, year, monthLabel]);

  if (status === "loading") return <SectionCard title="TL Ranking">Loading…</SectionCard>;
  if (status === "error" || !result) return <SectionCard title="TL Ranking">Couldn&apos;t load TL Ranking.</SectionCard>;

  const totalTarget = result.rankings.reduce((s, r) => s + r.mtdTarget, 0);
  const totalRevenue = result.rankings.reduce((s, r) => s + r.mtdRevenue, 0);
  const totalPct = totalTarget > 0 ? (totalRevenue / totalTarget) * 100 : null;

  return (
    <SectionCard title="TL Ranking" accent="blue">
      <TableWrap>
        <Thead>
          <Th>Team Leader</Th>
          <Th align="right">MTD Target</Th>
          <Th align="right">MTD Revenue</Th>
          <Th align="center">Achieved vs MTD</Th>
        </Thead>
        <tbody>
          {result.rankings.map((r) => (
            <tr key={r.teamLeaderId}>
              <Td>{r.teamLeaderName}</Td>
              <Td align="right">{formatCompact(r.mtdTarget)}</Td>
              <Td align="right">{formatCompact(r.mtdRevenue)}</Td>
              <Td align="center">
                <AchievementBadge pct={r.achievedPct} />
              </Td>
            </tr>
          ))}
          <TotalRow>
            <Td>Total Sales</Td>
            <Td align="right">{formatCompact(totalTarget)}</Td>
            <Td align="right">{formatCompact(totalRevenue)}</Td>
            <Td align="center">
              <AchievementBadge pct={totalPct} />
            </Td>
          </TotalRow>
        </tbody>
      </TableWrap>
      {result.unmatchedReps.length > 0 ? (
        <p className="mt-3 text-[13px] text-accent-amber">
          {result.unmatchedReps.length} rep(s) with revenue don&apos;t match any Team Leader roster entry (by SAP Name or Employee Name) — largest:{" "}
          {result.unmatchedReps
            .slice(0, 3)
            .map((u) => `${u.salesEmployee} (${formatCompact(u.revenue)})`)
            .join(", ")}
          .
        </p>
      ) : null}
    </SectionCard>
  );
}
