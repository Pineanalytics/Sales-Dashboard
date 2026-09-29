"use client";

import { SectionCard } from "@/components/ui/KpiGrid";

/** Empty placeholder — external fleet/route/delivery data to be provided
 *  and wired up in a follow-up build. */
export function FleetLogisticsTab() {
  return (
    <div id="fleet-logistics" className="@container flex flex-col gap-4">
      <SectionCard title="Fleet & Logistics" accent="navy">
        <p className="text-sm text-muted">
          Awaiting data — this tab is ready for route, delivery, and vehicle-tracking data once it&apos;s provided.
        </p>
      </SectionCard>
    </div>
  );
}
