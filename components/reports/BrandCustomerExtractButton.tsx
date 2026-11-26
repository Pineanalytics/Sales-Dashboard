"use client";

import { useState } from "react";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useDashboardStore } from "@/lib/store";
import { resolvePeriodMonths } from "@/lib/timeIntelligence";
import { periodLabelFor, triggerDownload } from "@/lib/reports/download";

const DOWNLOADS = {
  brands: { button: "Brand extract (Excel)", title: "Download the detailed brand and product extract (Excel) for the current period and principal filter", path: "/api/reports/brand-customer-extract", fallbackName: "brands-detailed-extract.xlsx" },
  customers: { button: "Customer extract (Excel)", title: "Download the customer analysis (Excel) for the current period and principal filter: top customers, those making 80% of sales, channel, segment and territory, SFA customer rankings and, for a shorter selection, the raw invoice lines", path: "/api/reports/brand-customer-extract", fallbackName: "customers-detailed-extract.xlsx" },
  customerRaw: { button: "Raw data (CSV)", title: "Download every invoice and credit note line behind the customer extract, for the current period and principal filter", path: "/api/reports/customer-raw-lines", fallbackName: "customer-raw-data.csv" },
} as const;

/** The detailed extracts for the Customer & Brand Portfolio page, built on the server for the live global period and
 *  principal filters. "customerRaw" is the line-level raw data as CSV. */
export function BrandCustomerExtractButton({ kind }: { kind: keyof typeof DOWNLOADS }) {
  const period = useDashboardStore((s) => s.selectedPeriod);
  const selectedPrincipalKeys = useDashboardStore((s) => s.selectedPrincipalKeys);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = DOWNLOADS[kind];

  async function run() {
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams({ label: periodLabelFor(period), principalLabel: selectedPrincipalKeys.length > 0 ? selectedPrincipalKeys.join(", ") : "All principals" });
      if (kind !== "customerRaw") params.set("kind", kind);
      for (const { year, monthIndex } of resolvePeriodMonths(period)) params.append("period", `${year}-${String(monthIndex + 1).padStart(2, "0")}`);
      for (const key of selectedPrincipalKeys) params.append("principal", key);
      const response = await fetch(`${download.path}?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to build the extract.");
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? download.fallbackName;
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
        onClick={run}
        title={download.title}
      >
        {pending ? "Building…" : download.button}
      </Button>
      {error ? <span className="max-w-[260px] text-right text-[11px] text-accent-red">{error}</span> : null}
    </div>
  );
}
