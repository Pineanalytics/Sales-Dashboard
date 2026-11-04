// The Purchases / stock-receipts report as a formatted Excel workbook, for the period and principal chosen. Built from the same summary the report page uses (summary.ts) plus the
// receipt register, so the figures agree. Money is whole shillings (excl. VAT, as SAP posted it to stock); returns and credits are negative.
import ExcelJS from "exceljs";
import { FONT, NAVY, setTitle, tableSheet, type Cell, type Column } from "../excelTables";
import type { MonthRef, PurchaseSummary, ReceiptLine, Row } from "./summary";
import { DOC_TYPE_LABELS } from "./types";

export interface PurchaseWorkbookInput {
  summary: PurchaseSummary;
  /** The receipt register; null when the selection was too large to list. */
  lines: ReceiptLine[] | null;
  missingMonths: MonthRef[];
  syncedAt: string | null;
  periodLabel: string;
  principalLabel: string;
  generatedAt: Date;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const receiptMonthLabel = (m: MonthRef): string => `${MONTH_NAMES[m.monthIndex]} ${m.year}`;

const share = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

export async function buildPurchaseWorkbook(input: PurchaseWorkbookInput): Promise<Buffer> {
  const { summary: s, lines, missingMonths, syncedAt, periodLabel, principalLabel, generatedAt } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pinefrost Sales Dashboard";
  wb.created = generatedAt;
  const sub = `${principalLabel} | ${periodLabel} | Stock receipts from SAP, KSh excl. VAT`;

  // ---- Summary ------------------------------------------------------------------------------------
  {
    const ws = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF0F9D58" } } });
    ws.views = [{ showGridLines: false }];
    setTitle(ws, 1, "Purchases & Stock Receipts", 16);
    const scope: [string, string][] = [
      ["Period", periodLabel],
      ["Principals", principalLabel],
      ["Months in the period", s.months.map(receiptMonthLabel).join(", ")],
      ["Receipts synced from SAP", syncedAt ? syncedAt.replace("T", " ").slice(0, 16) + " UTC" : "No receipts stored for this selection"],
      ["Generated", generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    ];
    if (missingMonths.length > 0) scope.push(["Not loaded", `${missingMonths.map(receiptMonthLabel).join(", ")}: no receipt lines are stored for these months, so they read zero here.`]);
    scope.forEach(([label, value], index) => {
      ws.getCell(3 + index, 1).value = label;
      ws.getCell(3 + index, 1).font = { name: FONT, size: 10, bold: true };
      ws.getCell(3 + index, 2).value = value;
      ws.getCell(3 + index, 2).font = { name: FONT, size: 10 };
    });

    const t = s.totals;
    const measures: { measure: string; value: Cell; fmt: "money" | "int"; note?: string }[] = [
      { measure: "Receipts", value: t.receipts, fmt: "money", note: "Goods received from suppliers against purchase orders" },
      { measure: "Returns & credits", value: t.returns, fmt: "money", note: "Goods returned to suppliers and AP credit memos (negative)" },
      { measure: "Other adjustments", value: t.other, fmt: "money", note: "Direct AP-invoice stock and price variances, landed costs, manual receipts" },
      { measure: "Net receipts", value: t.net, fmt: "money", note: "Receipts + returns & credits + other adjustments" },
      { measure: "Receipt cases", value: t.receiptCases, fmt: "int", note: "Pieces received / pack size on the Product master" },
      { measure: "Net cases", value: t.netCases, fmt: "int" },
      { measure: "Documents", value: t.docs, fmt: "int" },
      { measure: "Suppliers", value: t.suppliers, fmt: "int" },
    ];
    const header = 3 + scope.length + 1;
    ["Measure", "Value", "Note"].forEach((text, index) => {
      const cell = ws.getCell(header, index + 1);
      cell.value = text;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.alignment = { horizontal: index === 1 ? "right" : "left" };
    });
    measures.forEach((m, index) => {
      const row = header + 1 + index;
      ws.getCell(row, 1).value = m.measure;
      ws.getCell(row, 1).font = { name: FONT, size: 10, bold: m.measure === "Net receipts" };
      const value = ws.getCell(row, 2);
      value.value = m.value;
      value.numFmt = m.fmt === "money" ? "#,##0;[Red]-#,##0" : "#,##0";
      value.font = { name: FONT, size: 10, bold: m.measure === "Net receipts" };
      if (m.note) {
        ws.getCell(row, 3).value = m.note;
        ws.getCell(row, 3).font = { name: FONT, size: 9, italic: true, color: { argb: "FF5B6B80" } };
      }
    });

    let row = header + measures.length + 3;
    ws.getCell(row, 1).value = "By document type";
    ws.getCell(row, 1).font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } };
    row += 1;
    s.byDocType.forEach((d) => {
      ws.getCell(row, 1).value = DOC_TYPE_LABELS[d.docType];
      ws.getCell(row, 1).font = { name: FONT, size: 10 };
      ws.getCell(row, 2).value = d.value;
      ws.getCell(row, 2).numFmt = "#,##0;[Red]-#,##0";
      ws.getCell(row, 2).font = { name: FONT, size: 10 };
      ws.getCell(row, 3).value = `${d.docs.toLocaleString("en-KE")} documents, ${Math.round(d.cases).toLocaleString("en-KE")} cases`;
      ws.getCell(row, 3).font = { name: FONT, size: 9, italic: true, color: { argb: "FF5B6B80" } };
      row += 1;
    });

    row += 1;
    ws.getCell(row, 1).value = "Kept apart and checked";
    ws.getCell(row, 1).font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } };
    row += 1;
    const checks: [string, Cell, string][] = [
      ["Empties (returnable packaging) net", s.empties.net, `${s.empties.lines.toLocaleString("en-KE")} lines in the empties warehouses; not in any figure above`],
      ["Unallocated value", s.unallocated.value, `${s.unallocated.lines.toLocaleString("en-KE")} lines whose item is on no principal's list; they sit under "Unallocated"`],
      ["Lines with no pack size", s.noPackSize.lines, `${s.noPackSize.items.toLocaleString("en-KE")} items with a quantity but no pack size on the Product master; their cases read 0`],
    ];
    for (const [label, value, note] of checks) {
      ws.getCell(row, 1).value = label;
      ws.getCell(row, 1).font = { name: FONT, size: 10 };
      ws.getCell(row, 2).value = value;
      ws.getCell(row, 2).numFmt = "#,##0;[Red]-#,##0";
      ws.getCell(row, 2).font = { name: FONT, size: 10 };
      ws.getCell(row, 3).value = note;
      ws.getCell(row, 3).font = { name: FONT, size: 9, italic: true, color: { argb: "FF5B6B80" } };
      row += 1;
    }
    ws.getColumn(1).width = 38;
    ws.getColumn(2).width = 26;
    ws.getColumn(3).width = 90;
  }

  // ---- Roll-ups -----------------------------------------------------------------------------------
  const rollup = (firstHeader: string, extra: Column<Row>[] = []): Column<Row>[] => [
    { header: firstHeader, width: 36, value: (r) => r.label },
    ...extra,
    { header: "Receipts", fmt: "money", value: (r) => r.receipts },
    { header: "Returns & credits", fmt: "money", value: (r) => r.returns },
    { header: "Other adjustments", fmt: "money", value: (r) => r.other },
    { header: "Net receipts", fmt: "money", value: (r) => r.net },
    { header: "Share of net %", fmt: "pct", value: (r) => share(r.net, s.totals.net) },
    { header: "Receipt cases", fmt: "int", value: (r) => r.receiptCases },
    { header: "Net cases", fmt: "int", value: (r) => r.netCases },
    { header: "Documents", fmt: "int", value: (r) => r.docs },
  ];
  /** The totals row of a roll-up: "Total", blanks for any extra leading columns, then the sums in the columns' order. */
  const totalsRow = (rows: Row[], extraColumns = 0): (Cell | undefined)[] => {
    const sum = (pick: (r: Row) => number) => rows.reduce((a, r) => a + pick(r), 0);
    const net = sum((r) => r.net);
    return ["Total", ...Array<undefined>(extraColumns).fill(undefined), sum((r) => r.receipts), sum((r) => r.returns), sum((r) => r.other), net, share(net, s.totals.net), sum((r) => r.receiptCases), sum((r) => r.netCases), undefined];
  };

  tableSheet(wb, "By Principal", "Receipts by principal", sub, rollup("Principal"), s.byPrincipal, { totals: totalsRow(s.byPrincipal) });
  tableSheet(wb, "By Brand", "Receipts by brand (locations rolled together)", sub, rollup("Brand"), s.byBrand, { totals: totalsRow(s.byBrand) });
  tableSheet(wb, "By Supplier", "Receipts by supplier", sub, rollup("Supplier"), s.bySupplier, { totals: totalsRow(s.bySupplier) });
  tableSheet(wb, "By Warehouse", "Receipts by receiving warehouse", sub, rollup("Warehouse", [{ header: "Location", width: 14, value: (r) => (r as Row & { location: string }).location }]), s.byWarehouse, { totals: totalsRow(s.byWarehouse, 1) });

  // ---- Month on month ------------------------------------------------------------------------------
  {
    const monthColumns: Column<PurchaseSummary["monthlyByPrincipal"][number]>[] = s.months.map((m, index) => ({ header: receiptMonthLabel(m), fmt: "money" as const, value: (r) => r.months[index] ?? 0 }));
    tableSheet(
      wb,
      "Month on Month",
      "Net receipts by principal and month",
      sub,
      [{ header: "Principal", width: 28, value: (r) => r.principal }, ...monthColumns, { header: "Total", fmt: "money", value: (r) => r.total }],
      s.monthlyByPrincipal,
      { totals: ["Total", ...s.months.map((_, index) => s.monthlyByPrincipal.reduce((a, r) => a + (r.months[index] ?? 0), 0)), s.monthlyByPrincipal.reduce((a, r) => a + r.total, 0)] }
    );
    tableSheet(
      wb,
      "Totals by Month",
      "Receipts, returns and net by month",
      sub,
      [
        { header: "Month", width: 14, value: (r) => receiptMonthLabel(r) },
        { header: "Receipts", fmt: "money", value: (r) => r.receipts },
        { header: "Returns & credits", fmt: "money", value: (r) => r.returns },
        { header: "Other adjustments", fmt: "money", value: (r) => r.other },
        { header: "Net receipts", fmt: "money", value: (r) => r.net },
        { header: "Receipt cases", fmt: "int", value: (r) => r.receiptCases },
        { header: "Net cases", fmt: "int", value: (r) => r.netCases },
        { header: "Documents", fmt: "int", value: (r) => r.docs },
      ],
      s.byMonth
    );
  }

  // ---- Items and the register ---------------------------------------------------------------------
  tableSheet(
    wb,
    "Top Items",
    "Top 100 items by net receipts",
    sub,
    [
      { header: "Item code", width: 14, value: (r) => r.itemCode },
      { header: "Item", width: 40, value: (r) => r.itemName },
      { header: "Principal", width: 22, value: (r) => r.principal },
      { header: "Receipts", fmt: "money", value: (r) => r.receipts },
      { header: "Returns & credits", fmt: "money", value: (r) => r.returns },
      { header: "Net receipts", fmt: "money", value: (r) => r.net },
      { header: "Net cases", fmt: "int", value: (r) => r.netCases },
    ],
    s.topItems
  );

  if (lines) {
    tableSheet(
      wb,
      "Receipt Register",
      "Every receipt line",
      sub,
      [
        { header: "Date", width: 12, value: (r) => r.docDate },
        { header: "Document", width: 26, value: (r) => DOC_TYPE_LABELS[r.docType] },
        { header: "Doc no.", width: 10, value: (r) => r.docNum },
        { header: "Supplier", width: 30, value: (r) => `${r.supplierName} (${r.supplierCode})` },
        { header: "Principal", width: 20, value: (r) => r.principal },
        { header: "Item code", width: 12, value: (r) => r.itemCode },
        { header: "Item", width: 36, value: (r) => r.itemName },
        { header: "Warehouse", width: 12, value: (r) => r.warehouseCode },
        { header: "Stock", width: 9, value: (r) => (r.stockClass === "EMPTIES" ? "Empties" : "Goods") },
        { header: "Quantity (pcs)", fmt: "int", value: (r) => r.qty },
        { header: "Cases", fmt: "decimal", value: (r) => r.cases },
        { header: "Value (KSh)", fmt: "money", value: (r) => r.value },
      ],
      lines
    );
  }

  // ---- Notes --------------------------------------------------------------------------------------
  {
    const ws = wb.addWorksheet("Notes", { properties: { tabColor: { argb: "FF5B6B80" } } });
    ws.views = [{ showGridLines: false }];
    setTitle(ws, 1, "How to read this report", 14);
    const notes = [
      "Source: SAP Business One stock ledger (OINM): the movements posted by goods receipt POs, goods returns, AP invoices and credit memos, manual goods receipts and landed costs. Goods-receipt totals were checked to the goods-receipt documents themselves and agree.",
      "Values are KSh excl. VAT at the cost SAP posted to stock. A returned item is valued at SAP's stock cost, which can differ slightly from the supplier credit.",
      "Receipts are goods receipt POs. Returns & credits are goods returns to suppliers and AP credit memos. Other adjustments are AP invoices that post stock or a price variance without a goods receipt behind them, landed costs and manual receipts.",
      "A cancelled document posts its own reversing lines, so it nets to nothing; a document cancelled in a later month than it was posted shows as a negative in the month of the cancellation.",
      "Quantities are in pieces, the item's inventory unit, whatever unit the document used. Cases are pieces divided by the pack size on the Product master; items without a pack size show 0 cases.",
      "Principals are found the way sales are: the Product master's principal and the warehouse's location (with the same fixups), then the item-code rules; anything left is Unallocated and is still counted.",
      "Empties (returnable packaging, held in warehouses named EMPTIES) are excluded from every headline figure and reported on the Summary.",
      "Transfers between our own warehouses and customer returns are not purchases and are not included.",
    ];
    notes.forEach((text, index) => {
      const cell = ws.getCell(3 + index, 1);
      cell.value = text;
      cell.font = { name: FONT, size: 10 };
      cell.alignment = { wrapText: true, vertical: "top" };
      ws.getRow(3 + index).height = 44;
    });
    ws.getColumn(1).width = 130;
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
