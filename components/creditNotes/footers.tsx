import type { ReactNode } from "react";
import { Growth, compact, count, pct } from "@/components/performanceAnalysis/shared";
import type { CreditNoteKpi } from "@/lib/creditNotes/types";

interface Summable {
  credit: number;
  invoiced: number;
  cases: number;
  gpLost: number;
  share?: number;
}

const rateCell = (value: number | null): ReactNode => pct(value);

/** The total rows under a credit-note table. The tables share column ids (credit, share, invoiced, rate, cases, customers, items,
 *  change, gp), so one set of cells serves them all and a table simply ignores the ones it does not have.
 *
 *  `Total` is the whole selection (the headline figures), so it matches the cards above. When the list is cut to its top rows,
 *  a subtotal of the rows shown comes first, so the gap between what is listed and the total is visible. */
export function totalFooter({ rows, kpi, itemLabel, listedOf, labelColumn }: { rows: Summable[]; kpi: CreditNoteKpi; itemLabel: string; listedOf?: number; labelColumn?: string }) {
  const out: { label: string; cells: Record<string, ReactNode>; labelColumn?: string }[] = [];
  if (listedOf !== undefined && listedOf > rows.length) {
    const credit = rows.reduce((sum, row) => sum + row.credit, 0);
    const invoiced = rows.reduce((sum, row) => sum + row.invoiced, 0);
    out.push({
      label: `Top ${rows.length} shown`,
      labelColumn,
      cells: {
        credit: compact(credit),
        share: pct(rows.reduce((sum, row) => sum + (row.share ?? 0), 0)),
        invoiced: compact(invoiced),
        rate: rateCell(invoiced > 0 ? (credit / invoiced) * 100 : null),
        cases: count(rows.reduce((sum, row) => sum + row.cases, 0)),
        gp: compact(rows.reduce((sum, row) => sum + row.gpLost, 0)),
      },
    });
  }
  out.push({
    label: listedOf !== undefined && listedOf > rows.length ? `Total, all ${listedOf.toLocaleString("en-US")} ${itemLabel}` : `Total (${rows.length.toLocaleString("en-US")} ${itemLabel})`,
    labelColumn,
    cells: {
      credit: compact(kpi.credit),
      share: pct(kpi.credit > 0 ? 100 : 0),
      invoiced: compact(kpi.invoiced),
      rate: rateCell(kpi.cnPct),
      cases: count(kpi.cases),
      customers: count(kpi.customers),
      items: count(kpi.items),
      change: <Growth value={kpi.creditChangePct} />,
      gp: compact(kpi.gpLost),
    },
  });
  return out;
}
