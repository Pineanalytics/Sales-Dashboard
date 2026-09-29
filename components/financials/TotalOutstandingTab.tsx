"use client";

import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { bucketTier, money } from "@/components/views/ReceivablesView";
import { Badge } from "@/components/ui/Badge";
import type { KpiAccent } from "@/lib/format";
import type { AgeingBucket, ReceivablesDashboard } from "@/lib/receivables";

// Relabels the existing 5-bucket ageing profile (Current/1–30/31–60/61–90/Over
// 90) to the guideline's own 30/60/90/over-90 wording — same underlying
// figures as the Receivables & Ageing tab's own bucket section, presented as
// its own dedicated view per the guideline's separate numbered item.
const LABELS: Record<AgeingBucket, string> = {
  "Current": "Current",
  "1–30 days": "30 days",
  "31–60 days": "60 days",
  "61–90 days": "90 days",
  "Over 90 days": "Over 90 days",
};
const ICONS: Record<AgeingBucket, KpiAccent> = {
  "Current": "revenue",
  "1–30 days": "growth",
  "31–60 days": "quarter",
  "61–90 days": "mission",
  "Over 90 days": "coverage",
};
const ORDER: AgeingBucket[] = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"];

export function TotalOutstandingTab({ receivables }: { receivables: ReceivablesDashboard }) {
  const total = ORDER.reduce((sum, bucket) => sum + receivables.buckets[bucket], 0);

  return (
    <div id="total-outstanding" className="@container flex flex-col gap-4">
      <SectionCard title="Total outstanding" accent="red" action={<Badge tier="neutral">{money(total)} across all buckets</Badge>}>
        <div className="grid grid-cols-2 gap-3 @sm:grid-cols-3 @lg:grid-cols-5">
          {ORDER.map((bucket) => (
            <KpiCard
              key={bucket}
              accent={ICONS[bucket]}
              label={LABELS[bucket]}
              value={money(receivables.buckets[bucket])}
              sublabel={total > 0 ? `${((receivables.buckets[bucket] / total) * 100).toFixed(0)}% of outstanding` : "—"}
            />
          ))}
        </div>
      </SectionCard>
      <SectionCard title="By age bucket" accent="amber">
        <div className="flex flex-col gap-2">
          {ORDER.map((bucket) => (
            <div key={bucket} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2">
              <span className="text-sm font-medium text-brand-navy">{LABELS[bucket]}</span>
              <Badge tier={bucketTier(bucket)}>{money(receivables.buckets[bucket])}</Badge>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
