"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Td, Th, Thead } from "@/components/ui/Table";
import type { DedupPair } from "@/lib/universeAnalysis/types";
import type { QualityCheck } from "@/lib/universeAnalysis/quality";
import type { TargetAction, TargetRow } from "@/lib/universeAnalysis/opportunities";
import { CsvLink, Note, SectionState, count, plainPct, useSection, type AnalysisMeta } from "./shared";

const ACTIONS: TargetAction[] = ["Convert to direct", "Win back (lapsing)", "Fix strike rate", "Cross-sell"];

// ---------------------------------------------------------------- targets
interface TargetData {
  meta: AnalysisMeta;
  counts: Record<string, number>;
  rows: TargetRow[];
}

export function TargetsSection({ query }: { query: string }) {
  const [action, setAction] = useState<TargetAction>("Convert to direct");
  const { data, status } = useSection<TargetData>("targets", `${query}&action=${encodeURIComponent(action)}`);
  const pill = (active: boolean) => `rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-primary-blue text-white" : "border border-border text-primary-blue hover:bg-accent-blue-soft"}`;
  return (
    <SectionCard
      title="Target lists"
      action={<CsvLink href={`/api/universe-analysis?section=targets&format=csv&action=${encodeURIComponent(action)}&${query}`} />}
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button key={a} onClick={() => setAction(a)} className={pill(action === a)}>{a}</button>
        ))}
      </div>
      <div className="mb-3">
        <Note>
          Named outlets to act on, largest first (top 300 per list). Convert to direct: distributor-only outlets by year-to-date sales. Win back: direct outlets with no purchase for 30–89 days, by monthly run-rate. Fix strike rate: called 2+ times in the last 3 months with strike under 50%. Cross-sell: single-principal direct outlets by monthly run-rate.
        </Note>
      </div>
      <SectionState status={status}>
        {data ? (
          <TableWrap>
            <Thead>
              <Th>Outlet</Th>
              <Th>Master ID</Th>
              <Th>Principal(s)</Th>
              <Th>Segment</Th>
              <Th>Region</Th>
              <Th>Rep</Th>
              <Th align="right">Days since purchase</Th>
              <Th align="right">YTD sales (KES)</Th>
              <Th align="right">Monthly run-rate (KES)</Th>
              <Th align="right">Strike</Th>
              <Th>Why</Th>
            </Thead>
            <tbody>
              {data.rows.slice(0, 200).map((t) => (
                <tr key={`${t.action}-${t.masterOutletId}-${t.principals}`}>
                  <Td>{t.outlet}</Td>
                  <Td>{t.masterOutletId}</Td>
                  <Td className="max-w-[220px] truncate" title={t.principals}>{t.principals}</Td>
                  <Td>{t.segment ?? "–"}</Td>
                  <Td>{t.region}</Td>
                  <Td>{t.rep ?? "–"}</Td>
                  <Td align="right">{t.daysSincePurchase === null ? "–" : count(t.daysSincePurchase)}</Td>
                  <Td align="right">{count(t.salesYtd)}</Td>
                  <Td align="right">{t.monthlyRunRate === null ? "–" : count(t.monthlyRunRate)}</Td>
                  <Td align="right">{plainPct(t.strikeRatePct)}</Td>
                  <Td>{t.why}</Td>
                </tr>
              ))}
              {data.rows.length === 0 ? (
                <tr>
                  <Td className="text-muted">Nothing on this list for the current filters.</Td>
                </tr>
              ) : null}
            </tbody>
          </TableWrap>
        ) : null}
      </SectionState>
      {data && data.rows.length > 200 ? (
        <div className="mt-2">
          <Note>Showing the first 200 of {count(data.rows.length)}; download the CSV for the full list.</Note>
        </div>
      ) : null}
    </SectionCard>
  );
}

// ---------------------------------------------------------------- duplicates
interface MergedRecord {
  recKey: string;
  source: string;
  outlet: string;
  principals: string;
  region: string | null;
  masterId: string;
  isMaster: boolean;
  clusterSize: number;
  matchType: string;
  confidence: string;
  method: string;
  metresFromMaster: number | null;
  simToMaster: number | null;
  sales: number;
}

type ReviewPair = DedupPair & { outletA: string; sourceA: string; outletB: string; sourceB: string };

interface MergedData {
  meta: AnalysisMeta;
  total: number;
  records: MergedRecord[];
}
interface ReviewData {
  meta: AnalysisMeta;
  total: number;
  pairs: ReviewPair[];
}

export function DuplicatesSection({ query }: { query: string }) {
  const [status, setStatus] = useState<"merged" | "review">("merged");
  const merged = useSection<MergedData>("duplicates", `${query}&status=merged&limit=500`, status === "merged");
  const review = useSection<ReviewData>("duplicates", `${query}&status=review&limit=500`, status === "review");
  const pill = (active: boolean) => `rounded-full px-3 py-1 text-xs font-semibold ${active ? "bg-primary-blue text-white" : "border border-border text-primary-blue hover:bg-accent-blue-soft"}`;
  return (
    <SectionCard title="Duplicate outlets" action={<CsvLink href={`/api/universe-analysis?section=duplicates&format=csv&status=${status}&limit=5000&${query}`} />}>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setStatus("merged")} className={pill(status === "merged")}>Merged groups</button>
        <button onClick={() => setStatus("review")} className={pill(status === "review")}>Pairs to review</button>
      </div>
      <div className="mb-3">
        <Note>
          The same shop is often registered twice, within one system or across systems. Records are matched by GPS point (within 60 m) and cleaned name, and by the extract&apos;s own match id. High and medium matches are merged into one master outlet, so counts are of unique shops; pairs that look similar but differ (a branch number, a wholesale vs retail record, a common name) are listed for review and left unmerged. Leverage has no GPS, so it can only be matched through the match id.
        </Note>
      </div>
      {status === "merged" ? (
        <SectionState status={merged.status}>
          {merged.data ? (
            <>
              <TableWrap>
                <Thead>
                  <Th>Master ID</Th>
                  <Th>Record</Th>
                  <Th>Source</Th>
                  <Th>Outlet</Th>
                  <Th>Principals</Th>
                  <Th>Match</Th>
                  <Th>Confidence</Th>
                  <Th align="right">Metres from master</Th>
                  <Th align="right">Name similarity</Th>
                  <Th align="right">YTD sales (KES)</Th>
                </Thead>
                <tbody>
                  {merged.data.records.map((r) => (
                    <tr key={r.recKey} className={r.isMaster ? "font-semibold" : ""}>
                      <Td>{r.masterId}</Td>
                      <Td>{r.recKey}{r.isMaster ? " (master)" : ""}</Td>
                      <Td>{r.source}</Td>
                      <Td>{r.outlet}</Td>
                      <Td className="max-w-[200px] truncate" title={r.principals}>{r.principals}</Td>
                      <Td>{r.matchType}</Td>
                      <Td>{r.confidence}</Td>
                      <Td align="right">{r.metresFromMaster === null ? "–" : count(r.metresFromMaster)}</Td>
                      <Td align="right">{r.simToMaster === null ? "–" : r.simToMaster.toFixed(2)}</Td>
                      <Td align="right">{count(r.sales)}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <div className="mt-2"><Note>Showing {count(Math.min(500, merged.data.total))} of {count(merged.data.total)} records in merged groups; download for all.</Note></div>
            </>
          ) : null}
        </SectionState>
      ) : (
        <SectionState status={review.status}>
          {review.data ? (
            <>
              <TableWrap>
                <Thead>
                  <Th>Outlet A</Th>
                  <Th>System A</Th>
                  <Th>Outlet B</Th>
                  <Th>System B</Th>
                  <Th align="right">Name similarity</Th>
                  <Th align="right">Metres apart</Th>
                  <Th>Why not merged</Th>
                  <Th>Method</Th>
                </Thead>
                <tbody>
                  {review.data.pairs.map((p) => (
                    <tr key={`${p.a}|${p.b}`}>
                      <Td>{p.outletA}</Td>
                      <Td>{p.sourceA}</Td>
                      <Td>{p.outletB}</Td>
                      <Td>{p.sourceB}</Td>
                      <Td align="right">{p.nameSim.toFixed(2)}</Td>
                      <Td align="right">{p.distM === null ? "–" : count(p.distM)}</Td>
                      <Td>{p.reason}</Td>
                      <Td>{p.method}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <div className="mt-2"><Note>Showing {count(Math.min(500, review.data.total))} of {count(review.data.total)} pairs, most similar first; download for all.</Note></div>
            </>
          ) : null}
        </SectionState>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------- data quality
interface QualityData {
  meta: AnalysisMeta;
  checks: QualityCheck[];
}

const severityTier = (s: QualityCheck["severity"]) => (s === "High" ? "bad" : s === "Medium" ? "warn" : "neutral");

export function QualitySection({ query }: { query: string }) {
  const { data, status } = useSection<QualityData>("quality", query);
  return (
    <SectionState status={status}>
      {data ? (
        <SectionCard title="Data quality and method notes">
          <div className="mb-3">
            <Note>Checks run on every refresh of the analysis, ranked by how much they change the numbers. Fixing them at source makes the next analysis cleaner.</Note>
          </div>
          <TableWrap>
            <Thead>
              <Th>#</Th>
              <Th>Area</Th>
              <Th>Issue</Th>
              <Th>Evidence</Th>
              <Th>Severity</Th>
            </Thead>
            <tbody>
              {data.checks.map((c, i) => (
                <tr key={`${c.area}-${c.issue}`}>
                  <Td>{i + 1}</Td>
                  <Td>{c.area}</Td>
                  <Td className="whitespace-normal">{c.issue}</Td>
                  <Td className="whitespace-normal">{c.evidence}</Td>
                  <Td><Badge tier={severityTier(c.severity)}>{c.severity}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : null}
    </SectionState>
  );
}
