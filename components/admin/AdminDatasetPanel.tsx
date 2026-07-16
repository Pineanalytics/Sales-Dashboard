"use client";

import { useEffect, useRef } from "react";
import { ArrowUpload20Regular, DocumentTable20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { SectionCard } from "@/components/ui/KpiGrid";
import { Spinner } from "@/components/ui/Spinner";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";

/** Dataset upload + snapshot history, moved here from the Reports page so this
 *  admin-only content lives under /admin rather than mixed into the reports hub
 *  every viewer sees. Runs outside AnalyticsShell, so it fetches the latest
 *  dataset/history itself instead of relying on the shell's SSR hydration. */
export function AdminDatasetPanel() {
  const dataset = useDashboardStore((s) => s.dataset);
  const status = useDashboardStore((s) => s.status);
  const history = useDashboardStore((s) => s.history);
  const uploadFile = useDashboardStore((s) => s.uploadFile);
  const fetchLatest = useDashboardStore((s) => s.fetchLatest);
  const fetchHistory = useDashboardStore((s) => s.fetchHistory);
  const fetchSnapshot = useDashboardStore((s) => s.fetchSnapshot);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = status === "loading";

  useEffect(() => {
    if (!dataset) fetchLatest();
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadFile(file);
  }

  return (
    <>
      {dataset ? (
        <SectionCard title="Latest Dataset">
          <div className="flex flex-wrap items-center gap-6 p-1 text-sm">
            <div className="flex items-center gap-2 text-muted-strong">
              <DocumentTable20Regular className="h-5 w-5 text-secondary-blue" />
              <span className="font-medium">{dataset.reportMeta.title}</span>
            </div>
            <span className="text-muted">Uploaded {new Date(dataset.uploadedAt).toLocaleString()}</span>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Upload Dataset">
        <div className="flex flex-wrap items-center gap-3 p-1">
          <p className="text-xs text-muted max-w-md">
            Upload the monthly Excel export to refresh revenue, coverage, profitability, stock and forecast data
            for every principal.
          </p>
          <Button
            variant="primary"
            icon={uploading ? <Spinner className="h-3.5 w-3.5" /> : <ArrowUpload20Regular className="h-4 w-4" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Processing…" : "Upload Excel"}
          </Button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
        </div>
      </SectionCard>

      <SectionCard title="Snapshot History">
        {history.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No snapshot history yet.</p>
        ) : (
          <TableWrap>
            <Thead>
              <Th>Report</Th>
              <Th>Uploaded</Th>
              <Th align="right">Action</Th>
            </Thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <Td>{h.reportTitle}</Td>
                  <Td>{new Date(h.uploadedAt).toLocaleString()}</Td>
                  <Td align="right">
                    <button
                      onClick={() => fetchSnapshot(h.id)}
                      className="text-xs font-semibold text-primary-blue hover:text-secondary-blue transition-colors"
                    >
                      Load
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </SectionCard>
    </>
  );
}
