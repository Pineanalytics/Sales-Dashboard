"use client";

import { useEffect } from "react";
import { DocumentTable20Regular } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { SectionCard } from "@/components/ui/KpiGrid";
import { TableWrap, Thead, Th, Td } from "@/components/ui/Table";

/** Sync status and the legacy snapshot archive. The dashboard itself now reads
 * server-synchronized facts directly, rather than accepting workbook uploads. */
export function AdminDatasetPanel() {
  const dataset = useDashboardStore((s) => s.dataset);
  const history = useDashboardStore((s) => s.history);
  const fetchLatest = useDashboardStore((s) => s.fetchLatest);
  const fetchHistory = useDashboardStore((s) => s.fetchHistory);

  useEffect(() => {
    if (!dataset) fetchLatest();
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {dataset ? (
        <SectionCard title="Live dashboard data">
          <div className="flex flex-wrap items-center gap-6 p-1 text-sm">
            <div className="flex items-center gap-2 text-muted-strong">
              <DocumentTable20Regular className="h-5 w-5 text-secondary-blue" />
              <span className="font-medium">{dataset.reportMeta.title}</span>
            </div>
            <span className="text-muted">Loaded {new Date(dataset.uploadedAt).toLocaleString()}</span>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="Legacy snapshot archive">
        {history.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No legacy snapshots retained.</p>
        ) : (
          <TableWrap>
            <Thead>
              <Th>Report</Th>
              <Th>Uploaded</Th>
            </Thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <Td>{h.reportTitle}</Td>
                  <Td>{new Date(h.uploadedAt).toLocaleString()}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </SectionCard>
    </>
  );
}
