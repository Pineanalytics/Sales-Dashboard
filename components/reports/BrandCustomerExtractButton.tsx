"use client";

import { useState } from "react";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useDashboardStore } from "@/lib/store";
import { resolvePeriodMonths } from "@/lib/timeIntelligence";
import { periodLabelFor, triggerDownload } from "@/lib/reports/download";

const TEXT = {
  brands: { button: "Brand extract", title: "Download the detailed brand and product extract (Excel) for the current period and principal filter" },
  customers: { button: "Customer extract", title: "Download the detailed customer extract (Excel) for the current period and principal filter" },
} as const;

/** The detailed raw-data Excel extract for the Customer & Brand Portfolio page. The workbook is built on the server
 *  from the same SAP item-level rows the page shows, for the live global period and principal filters. */
export function BrandCustomerExtractButton({ kind }: { kind: "brands" | "customers" }) {
  const period = useDashboardStore((s) => s.selectedPeriod);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind, label: periodLabelFor(period), principalLabel: selectedPrincipalKeys.length > 0 ? selectedPrincipalKeys.join(", ") : "All principals" });
      for (const { year, monthIndex } of resolvePeriodMonths(period)) params.append("period", `${year}-${String(monthIndex + 1).padStart(2, "0")}`);
      for (const key of selectedPrincipalKeys) params.append("principal", key);
      const response = await fetch(`/api/reports/brand-customer-extract?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to build the extract.");
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? `${kind}-detailed-extract.xlsx`;
      triggerDownload(await response.blob(), filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build the extract.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        className="px-3 py-1.5"
        icon={pending ? <Spinner className="h-3 w-3" /> : <ArrowDownload20Regular className="h-3.5 w-3.5" />}
        disabled={pending}
        onClick={download}
        title={TEXT[kind].title}
      >
        {pending ? "Building…" : `${TEXT[kind].button} (Excel)`}
      </Button>
      {error ? <span className="max-w-[260px] text-right text-[11px] text-accent-red">{error}</span> : null}
    </div>
  );
}
