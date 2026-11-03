"use client";

import { useState } from "react";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { triggerDownload } from "@/lib/reports/download";

interface ExportButtonProps {
  /** The page's own request (`months=...&principals=...`), so the workbook covers exactly what the page shows. */
  query: string;
  periodLabel: string;
  principalLabel: string;
  disabled?: boolean;
}

/** Downloads the whole Performance Analysis (every tab, plus the full item, customer, rep and branch lists) as a formatted Excel workbook
 *  for the period and principals currently selected. Built on the server from the same stored SAP lines as the page. */
export function ExportButton({ query, periodLabel, principalLabel, disabled }: ExportButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams(query);
      params.set("label", periodLabel);
      params.set("principalLabel", principalLabel);
      const response = await fetch(`/api/performance-analysis/export?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to build the export.");
      }
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "performance-analysis.xlsx";
      triggerDownload(await response.blob(), filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build the export.");
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
        disabled={pending || disabled}
        onClick={download}
        title="Download the whole analysis (Excel) for the current period and principal filter"
      >
        {pending ? "Building…" : "Export report (Excel)"}
      </Button>
      {error ? <span className="max-w-[260px] text-right text-[11px] text-accent-red">{error}</span> : null}
    </div>
  );
}
