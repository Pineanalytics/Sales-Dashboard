// Collapses line-level P&L journal-entry rows to the app's monthly-fact grain
// (Year+Month+Principal+AccountCode+LineType, summing DocTotal into amount) —
// mirrors how scripts/db-bridge/transform/buildMonthlySales.ts collapses
// YTD_Raw's item+warehouse grain down to Principal+Location.
import { CANONICAL_MONTHS } from "@/lib/timeIntelligence";
import type { PLRawRow } from "./query";

export interface PLUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  accountCode: string;
  accountName: string;
  lineType: PLRawRow["lineType"];
  amount: number;
}

interface PrincipalRow {
  principal: string;
  status: string;
}

export interface TransformResult {
  rows: PLUploadRow[];
  unmatchedCostCentres: string[];
}

export function buildPL(rawRows: PLRawRow[], principals: PrincipalRow[]): TransformResult {
  const activePrincipals = new Set(principals.filter((p) => p.status === "Active").map((p) => p.principal));
  const unmatched = new Set<string>();

  interface Agg extends PLUploadRow {}
  const byKey = new Map<string, Agg>();

  for (const row of rawRows) {
    if (!activePrincipals.has(row.costCenter)) {
      unmatched.add(row.costCenter);
      // Still include it — an unmatched Cost Centre is a data-quality signal to
      // review, not a reason to silently drop real P&L figures from the report.
    }

    const year = String(row.docDate.getUTCFullYear());
    const monthIndex = row.docDate.getUTCMonth();
    const month = CANONICAL_MONTHS[monthIndex];
    const key = `${year}|${month}|${row.costCenter}|${row.accountCode}|${row.lineType}`;

    const existing = byKey.get(key);
    if (existing) {
      existing.amount += row.docTotal;
    } else {
      byKey.set(key, {
        year,
        month,
        monthIndex,
        principal: row.costCenter,
        accountCode: row.accountCode,
        accountName: row.accountName,
        lineType: row.lineType,
        amount: row.docTotal,
      });
    }
  }

  return { rows: Array.from(byKey.values()), unmatchedCostCentres: Array.from(unmatched) };
}
