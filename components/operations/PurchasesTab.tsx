"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { Button } from "@/components/ui/Button";
import { KpiCard } from "@/components/ui/KpiCard";
import { SectionCard } from "@/components/ui/KpiGrid";
import { Spinner } from "@/components/ui/Spinner";
import { TableWrap, Thead, Th, Td, TotalRow } from "@/components/ui/Table";
import { formatCompact, formatNumber } from "@/lib/format";
import { normalizePrincipalKey } from "@/lib/normalize";
import type { PurchaseSummary, Row } from "@/lib/purchaseReceipts/summary";
import { periodLabelFor, triggerDownload } from "@/lib/reports/download";
import { CANONICAL_MONTHS, resolvePeriodMonths, type PeriodSelection } from "@/lib/timeIntelligence";

export interface PurchasesPayload {
  summary: PurchaseSummary;
  missingMonths: { year: number; monthIndex: number }[];
  syncedAt: string | null;
}

type Result = { query: string; data?: PurchasesPayload; error?: string };

const monthName = (m: { year: number; monthIndex: number }) => `${CANONICAL_MONTHS[m.monthIndex]} ${m.year}`;
const whole = (value: number) => formatNumber(Math.round(value));

/** Stock received from suppliers per principal for the page's period and principal filter: goods receipts less returns and credits, from SAP's stock ledger
 *  (synced hourly into PurchaseReceiptLine). The same numbers as the Purchases & Stock Receipts report on the Reports page, which carries the full Excel. */
export function PurchasesTab({ period, selectedPrincipalKey }: { period: PeriodSelection; selectedPrincipalKey: string | null }) {
  const [result, setResult] = useState<Result | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // The page's principal filter is a Brand-Location name ("EABL-Nyeri"); like the Stock Balance tab beside this one, purchases follow the brand, and the table can still split it by location.
  const brandKey = selectedPrincipalKey ? normalizePrincipalKey(selectedPrincipalKey) : null;
  const brandLabel = selectedPrincipalKey ? selectedPrincipalKey.split("-")[0].trim() : null;
  const params = new URLSearchParams();
  for (const { year, monthIndex } of resolvePeriodMonths(period)) params.append("period", `${year}-${String(monthIndex + 1).padStart(2, "0")}`);
  if (brandKey) params.append("principal", brandKey);
  const query = params.toString();

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reports/purchase-receipts?${query}&format=json`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Failed to load purchases.");
        if (!cancelled) setResult({ query, data: body as PurchasesPayload });
      })
      .catch((error: Error) => {
        if (!cancelled) setResult({ query, error: error.message });
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  async function download() {
    setExporting(true);
    setExportError(null);
    try {
      const label = new URLSearchParams(query);
      label.set("label", periodLabelFor(period));
      label.set("principalLabel", brandLabel ?? "All principals");
      const response = await fetch(`/api/reports/purchase-receipts?${label.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Failed to build the Excel.");
      const filename = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "purchases.xlsx";
      triggerDownload(await response.blob(), filename);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to build the Excel.");
    } finally {
      setExporting(false);
    }
  }

  const current = result?.query === query ? result : null;
  const exportButton = (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" className="px-3 py-1.5" icon={exporting ? <Spinner className="h-3 w-3" /> : <ArrowDownload20Regular className="h-3.5 w-3.5" />} disabled={exporting || !current?.data} onClick={download} title="Download the full purchases workbook (every receipt line) for the current period and principal">
        {exporting ? "Building…" : "Export Excel"}
      </Button>
      {exportError ? <span className="max-w-[260px] text-right text-[11px] text-accent-red">{exportError}</span> : null}
    </div>
  );

  if (!current) {
    return (
      <div id="purchases" className="@container flex flex-col gap-4">
        <SectionCard title="Purchases per principal" accent="navy" action={exportButton}>
          <p className="text-sm text-muted">Loading purchases…</p>
        </SectionCard>
      </div>
    );
  }
  if (current.error || !current.data) {
    return (
      <div id="purchases" className="@container flex flex-col gap-4">
        <SectionCard title="Purchases per principal" accent="navy">
          <p className="text-sm text-accent-red">{current.error ?? "Failed to load purchases."}</p>
        </SectionCard>
      </div>
    );
  }

  return (
    <div id="purchases" className="@container flex flex-col gap-4">
      <PurchasesPanel data={current.data} periodLabel={periodLabelFor(period)} principalLabel={brandLabel} action={exportButton} />
    </div>
  );
}

/** What the tab shows once the receipts have loaded: the totals, the table by principal (brand, or brand and location), by month, and the data notes. */
export function PurchasesPanel({ data, periodLabel, principalLabel, action }: { data: PurchasesPayload; periodLabel: string; principalLabel: string | null; action?: ReactNode }) {
  const [by, setBy] = useState<"brand" | "principal">("brand");
  const { summary: s, missingMonths, syncedAt } = data;
  const t = s.totals;
  const rows: Row[] = by === "brand" ? s.byBrand : s.byPrincipal;
  const empty = t.docs === 0;

  return (
    <>
      <SectionCard title="Purchases per principal" accent="navy" action={action}>
        <p className="text-sm text-muted">
          Stock received from suppliers in {periodLabel}{principalLabel ? ` for ${principalLabel}` : ""}: goods receipts against purchase orders, less goods returned and supplier credits. Values are KSh excl. VAT at the cost SAP posted to stock; volume is in cases.
        </p>
        {missingMonths.length > 0 ? (
          <p className="mt-2 text-sm font-semibold text-brand-orange">No receipts are loaded for {missingMonths.map(monthName).join(", ")}, so they read zero here.</p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-3 @sm:grid-cols-4">
          <KpiCard accent="revenue" label="Receipts" value={formatCompact(t.receipts)} sublabel={`${formatNumber(t.docs)} documents`} />
          <KpiCard accent="mission" label="Returns & credits" value={formatCompact(t.returns)} />
          <KpiCard accent="growth" label="Net purchases" value={formatCompact(t.net)} sublabel="Receipts less returns and credits" />
          <KpiCard accent="coverage" label="Net volume" value={formatCompact(t.netCases)} sublabel="Cases" />
        </div>
      </SectionCard>

      <SectionCard
        title="By principal"
        accent="navy"
        action={
          <div className="flex gap-1 rounded-full bg-background-elevated p-0.5" role="group" aria-label="Group principals by">
            {([["brand", "Brand"], ["principal", "Brand & location"]] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={by === value} onClick={() => setBy(value)} className={`rounded-full px-3 py-1 text-xs font-semibold ${by === value ? "bg-primary-blue text-white" : "text-muted-strong hover:text-primary-blue"}`}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {empty ? (
          <p className="text-sm text-muted">No receipts are stored for this period{principalLabel ? " and principal" : ""}.</p>
        ) : (
          <TableWrap>
            <Thead>
              <Th>Principal</Th>
              <Th align="right">Receipts (value)</Th>
              <Th align="right">Returns & credits</Th>
              <Th align="right">Net purchases (value)</Th>
              <Th align="right">Net purchases (volume)</Th>
              <Th align="right">Share of net</Th>
            </Thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <Td>{r.label}</Td>
                  <Td align="right">{whole(r.receipts)}</Td>
                  <Td align="right">{whole(r.returns)}</Td>
                  <Td align="right">{whole(r.net)}</Td>
                  <Td align="right">{whole(r.netCases)}</Td>
                  <Td align="right">{t.net > 0 ? `${((r.net / t.net) * 100).toFixed(1)}%` : "—"}</Td>
                </tr>
              ))}
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{whole(t.receipts)}</Td>
                <Td align="right">{whole(t.returns)}</Td>
                <Td align="right">{whole(t.net)}</Td>
                <Td align="right">{whole(t.netCases)}</Td>
                <Td align="right">100%</Td>
              </TotalRow>
            </tbody>
          </TableWrap>
        )}
      </SectionCard>

      {!empty && s.byMonth.length > 1 ? (
        <SectionCard title="By month" accent="navy">
          <TableWrap>
            <Thead>
              <Th>Month</Th>
              <Th align="right">Receipts (value)</Th>
              <Th align="right">Returns & credits</Th>
              <Th align="right">Net purchases (value)</Th>
              <Th align="right">Net purchases (volume)</Th>
              <Th align="right">Documents</Th>
            </Thead>
            <tbody>
              {s.byMonth.map((m) => (
                <tr key={`${m.year}-${m.monthIndex}`}>
                  <Td>{monthName(m)}</Td>
                  <Td align="right">{whole(m.receipts)}</Td>
                  <Td align="right">{whole(m.returns)}</Td>
                  <Td align="right">{whole(m.net)}</Td>
                  <Td align="right">{whole(m.netCases)}</Td>
                  <Td align="right">{formatNumber(m.docs)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </SectionCard>
      ) : null}

      {!empty ? (
        <SectionCard title="Notes" accent="blue">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
            {s.empties.lines > 0 ? <li>Returnable packaging (empties) is left out of the figures above: net KSh {whole(s.empties.net)}.</li> : null}
            {s.unallocated.lines > 0 ? <li>KSh {whole(s.unallocated.value)} ({formatNumber(s.unallocated.lines)} lines) is for items that are on no principal&apos;s list; it is counted under Unallocated until the items are added to the Product master.</li> : null}
            {s.noPackSize.lines > 0 ? <li>{formatNumber(s.noPackSize.items)} items have no pack size on the Product master, so their volume reads 0 cases (their value is counted).</li> : null}
            <li>Returns are valued at SAP&apos;s stock cost, which can differ slightly from the supplier credit.</li>
            <li>{syncedAt ? `Receipts last synced from SAP ${new Date(syncedAt).toLocaleString()}; the sync runs hourly.` : "No receipts have been synced for this selection."}</li>
          </ul>
        </SectionCard>
      ) : null}
    </>
  );
}
