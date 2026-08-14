import type { FormFieldMeta } from "./formData";
import { byLabel } from "./formData";
import { effectiveLabel, type SubmissionRow } from "./dashboard";

// Mirrors the "Retail_Merchandising_Dashboard" template exactly: a Raw Data
// sheet holding one row per visit, and every other sheet computing its
// numbers with live Excel formulas (COUNTIF/AVERAGEIF/COUNTIFS) against that
// sheet — nothing here is a JS-precomputed value, so the workbook keeps
// recalculating if someone edits Raw Data by hand.

const NAVY = "FF1F3864";
const BLUE = "FF2E75B6";
const GREEN = "FF2E7D32";
const AMBER = "FFC55A11";
const RED = "FFC00000";
const TOTAL_ROW_FILL = "FFD9E2F3";
const WHITE = "FFFFFFFF";

function poStatusLabel(raw: string): string {
  if (!raw || raw === "None") return "No PO Raised";
  return raw;
}

interface RawRow {
  date: Date | null;
  time: string;
  merchandiser: string;
  retailer: string;
  region: string;
  branch: string;
  sharePct: number | null;
  oos: string;
  oosItems: string;
  competitor: string;
  competitorName: string;
  skuCount: number;
  visitFrequency: string;
  positioning: number | null;
  poStatus: string;
  delivery: string;
  poValue: number;
  remarks: string;
  merchandiserCode: string;
}

function buildRawRows(fields: FormFieldMeta[], rows: SubmissionRow[]): RawRow[] {
  const merchandiser = byLabel(fields, "Merchandiser Name");
  const retailer = byLabel(fields, "Retailer Name");
  const retailerOther = byLabel(fields, "Retailer Name (if Other)");
  const region = byLabel(fields, "Region");
  const location = byLabel(fields, "Retailer Location / Branch");
  const locationOther = byLabel(fields, "Retailer Location (if Other)");
  const shelfPct = byLabel(fields, "Share of Shelf (%)");
  const oos = byLabel(fields, "Out of Stock (OOS)");
  const oosItems = byLabel(fields, "OOS List Of Items");
  const competitor = byLabel(fields, "Competitor Activity Present");
  const competitorName = byLabel(fields, "Competitor Activity Name (if any)");
  const skus = byLabel(fields, "SKUs Listed / Placed in Store");
  const visitFrequency = byLabel(fields, "Visit Frequency");
  const positioning = byLabel(fields, "Product Positioning (1 = worst, 5 = best)");
  const poStatus = byLabel(fields, "Purchase Order Status");
  const delivery = byLabel(fields, "Delivery Status");
  const poValue = byLabel(fields, "P.O. Value (Amount)");
  const remarks = byLabel(fields, "Additional Remarks");

  return rows.map((r) => {
    const d = new Date(r.submittedAt);
    const sharePctRaw = shelfPct ? parseFloat(r.answers[shelfPct.id]) : NaN;
    const positioningRaw = positioning ? parseFloat(r.answers[positioning.id]) : NaN;
    return {
      date: isNaN(d.getTime()) ? null : d,
      time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      merchandiser: merchandiser ? r.answers[merchandiser.id] ?? "" : "",
      retailer: retailer
        ? effectiveLabel(r.answers[retailer.id], retailerOther ? r.answers[retailerOther.id] : undefined)
        : "",
      region: region ? r.answers[region.id] ?? "" : "",
      branch: location
        ? effectiveLabel(r.answers[location.id], locationOther ? r.answers[locationOther.id] : undefined)
        : "",
      sharePct: isFinite(sharePctRaw) ? sharePctRaw : null,
      oos: oos ? r.answers[oos.id] ?? "" : "",
      oosItems: (oosItems ? r.answers[oosItems.id] : "") || "",
      competitor: competitor ? r.answers[competitor.id] ?? "" : "",
      competitorName: (competitorName ? r.answers[competitorName.id] : "") || "",
      skuCount: skus
        ? (r.answers[skus.id] ?? "").split(",").map((s) => s.trim()).filter(Boolean).length
        : 0,
      visitFrequency: visitFrequency ? r.answers[visitFrequency.id] ?? "" : "",
      positioning: isFinite(positioningRaw) ? positioningRaw : null,
      poStatus: poStatusLabel(poStatus ? r.answers[poStatus.id] ?? "" : ""),
      delivery: delivery ? r.answers[delivery.id] ?? "" : "",
      poValue: poValue ? parseFloat(r.answers[poValue.id]) || 0 : 0,
      remarks: (remarks ? r.answers[remarks.id] : "") || "",
      merchandiserCode: r.merchandiserCode ?? "",
    };
  });
}

function countDistinctByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function kpiTile(
  sheet: any,
  labelRange: string,
  valueRange: string,
  label: string,
  formula: string,
  color: string,
  numFmt: string
) {
  sheet.mergeCells(labelRange);
  const labelCell = sheet.getCell(labelRange.split(":")[0]);
  labelCell.value = label;
  labelCell.font = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
  labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  labelCell.alignment = { horizontal: "center", vertical: "middle" };

  sheet.mergeCells(valueRange);
  const valueCell = sheet.getCell(valueRange.split(":")[0]);
  valueCell.value = { formula };
  valueCell.font = { name: "Arial", size: 20, bold: true, color: { argb: WHITE } };
  valueCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  valueCell.alignment = { horizontal: "center", vertical: "middle" };
  valueCell.numFmt = numFmt;
}

// Sheet holding one row per group (merchandiser / retailer / region), with
// every metric a live formula against Raw Data — matches the template's
// "Merchandiser Perf" / "Retailer Perf" / "Region Perf" sheets exactly.
function buildPerfSheet(
  workbook: any,
  sheetName: string,
  groupLabel: string,
  groupColLetter: string,
  groupValues: string[],
  lastRawRow: number
) {
  const sheet = workbook.addWorksheet(sheetName);
  sheet.mergeCells("A1:H1");
  const title = sheet.getCell("A1");
  title.value = `${sheetName.replace(" Perf", "")} Performance`;
  title.font = { name: "Arial", size: 14, bold: true, color: { argb: WHITE } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };

  const headers = [
    groupLabel,
    "Visits",
    "Avg Share of Shelf %",
    "Avg SKUs in Store",
    "OOS Incidents",
    "OOS Rate %",
    "Avg Positioning Score",
    "Orders Delivered %",
  ];
  const headerRow = sheet.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  const firstDataRow = 4;
  groupValues.forEach((name, i) => {
    const r = firstDataRow + i;
    const row = sheet.getRow(r);
    row.getCell(1).value = name;
    row.getCell(2).value = { formula: `COUNTIF('Raw Data'!${groupColLetter}:${groupColLetter},A${r})` };
    row.getCell(3).value = { formula: `AVERAGEIF('Raw Data'!${groupColLetter}:${groupColLetter},A${r},'Raw Data'!G:G)` };
    row.getCell(3).numFmt = '0.0"%"';
    row.getCell(4).value = { formula: `AVERAGEIF('Raw Data'!${groupColLetter}:${groupColLetter},A${r},'Raw Data'!L:L)` };
    row.getCell(4).numFmt = "0.0";
    row.getCell(5).value = {
      formula: `COUNTIFS('Raw Data'!${groupColLetter}:${groupColLetter},A${r},'Raw Data'!H:H,"Yes")`,
    };
    row.getCell(6).value = { formula: `E${r}/B${r}` };
    row.getCell(6).numFmt = "0%";
    row.getCell(7).value = { formula: `AVERAGEIF('Raw Data'!${groupColLetter}:${groupColLetter},A${r},'Raw Data'!N:N)` };
    row.getCell(7).numFmt = "0.00";
    row.getCell(8).value = {
      formula: `COUNTIFS('Raw Data'!${groupColLetter}:${groupColLetter},A${r},'Raw Data'!P:P,"Order Delivered")/B${r}`,
    };
    row.getCell(8).numFmt = "0%";
  });

  const totalRowIdx = firstDataRow + groupValues.length;
  const lastGroupRow = totalRowIdx - 1;
  const totalRow = sheet.getRow(totalRowIdx);
  const totalCells: [number, string, string?][] = [
    [1, "TOTAL / AVERAGE"],
    [2, `=SUM(B${firstDataRow}:B${lastGroupRow})`],
    [3, `=AVERAGE('Raw Data'!G2:G${lastRawRow})`, '0.0"%"'],
    [4, `=AVERAGE('Raw Data'!L2:L${lastRawRow})`, "0.0"],
    [5, `=SUM(E${firstDataRow}:E${lastGroupRow})`],
    [6, `=E${totalRowIdx}/B${totalRowIdx}`, "0%"],
    [7, `=AVERAGE('Raw Data'!N2:N${lastRawRow})`, "0.00"],
    [8, `=COUNTIF('Raw Data'!P2:P${lastRawRow},"Order Delivered")/B${totalRowIdx}`, "0%"],
  ];
  for (const [col, formula, numFmt] of totalCells) {
    const cell = totalRow.getCell(col);
    cell.value = col === 1 ? formula : { formula: formula.replace(/^=/, "") };
    cell.font = { name: "Arial", bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_ROW_FILL } };
    if (numFmt) cell.numFmt = numFmt;
  }

  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 10;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 16;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 20;
  sheet.getColumn(8).width = 20;

  return sheet;
}

export async function buildDashboardWorkbook(
  formTitle: string,
  fields: FormFieldMeta[],
  rows: SubmissionRow[],
  filterLabel?: string
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Field Data Forms";
  workbook.created = new Date();

  const rawRows = buildRawRows(fields, rows);
  const lastRawRow = rawRows.length + 1; // header is row 1

  // ---------------- Raw Data ----------------
  const rawSheet = workbook.addWorksheet("Raw Data");
  const rawHeaders = [
    "Visit Date",
    "Visit Time",
    "Merchandiser Name",
    "Retailer Name",
    "Region",
    "Retailer Location / Branch",
    "Share of Shelf (%)",
    "Out of Stock (OOS)",
    "OOS List Of Items",
    "Competitor Activity Present",
    "Competitor Activity Name (if any)",
    "SKU Count",
    "Visit Frequency",
    "Product Positioning (1 = worst, 5 = best)",
    "PO Status Clean",
    "Delivery Status",
    "P.O. Value (Amount)",
    "Additional Remarks",
    "Merchandiser Code",
  ];
  const rawHeaderRow = rawSheet.getRow(1);
  rawHeaders.forEach((h, i) => {
    const cell = rawHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  });
  rawRows.forEach((r, i) => {
    const row = rawSheet.getRow(i + 2);
    row.getCell(1).value = r.date;
    row.getCell(1).numFmt = "yyyy\\-mm\\-dd";
    row.getCell(2).value = r.time;
    row.getCell(3).value = r.merchandiser;
    row.getCell(4).value = r.retailer;
    row.getCell(5).value = r.region;
    row.getCell(6).value = r.branch;
    row.getCell(7).value = r.sharePct;
    row.getCell(7).numFmt = '0.0"%"';
    row.getCell(8).value = r.oos;
    row.getCell(9).value = r.oosItems;
    row.getCell(10).value = r.competitor;
    row.getCell(11).value = r.competitorName;
    row.getCell(12).value = r.skuCount;
    row.getCell(13).value = r.visitFrequency;
    row.getCell(14).value = r.positioning;
    row.getCell(15).value = r.poStatus;
    row.getCell(16).value = r.delivery;
    row.getCell(17).value = r.poValue;
    row.getCell(17).numFmt = "#,##0.00";
    row.getCell(18).value = r.remarks;
    row.getCell(19).value = r.merchandiserCode;
  });
  const rawWidths = [12, 8, 16, 26, 14, 24, 14, 10, 34, 12, 22, 10, 12, 14, 14, 15, 14, 30, 14];
  rawWidths.forEach((w, i) => (rawSheet.getColumn(i + 1).width = w));
  rawSheet.views = [{ state: "frozen", ySplit: 1 }];

  // ---------------- Dashboard ----------------
  const dash = workbook.addWorksheet("Dashboard", { properties: { tabColor: { argb: NAVY } } });
  dash.mergeCells("A1:L2");
  const titleCell = dash.getCell("A1");
  titleCell.value = `${formTitle.toUpperCase()} — STORE VISIT DASHBOARD`;
  titleCell.font = { name: "Arial", size: 20, bold: true, color: { argb: WHITE } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  titleCell.alignment = { vertical: "middle" };

  dash.mergeCells("A3:L3");
  const subtitleCell = dash.getCell("A3");
  const filterNote = filterLabel ? ` | Filtered: ${filterLabel}` : "";
  subtitleCell.value = {
    formula: `CONCATENATE("Visit period: ", TEXT(MIN('Raw Data'!A2:A${lastRawRow}),"dd mmm yyyy")," - ",TEXT(MAX('Raw Data'!A2:A${lastRawRow}),"dd mmm yyyy")," | Total visits logged: ",COUNTA('Raw Data'!A2:A${lastRawRow}),"${filterNote}")`,
  };
  subtitleCell.font = { name: "Arial", size: 10, color: { argb: NAVY } };

  kpiTile(dash, "A5:B6", "A7:B7", "TOTAL VISITS", `COUNTA('Raw Data'!A2:A${lastRawRow})`, NAVY, "0");
  kpiTile(dash, "C5:D6", "C7:D7", "AVG SHARE OF SHELF", `AVERAGE('Raw Data'!G2:G${lastRawRow})`, BLUE, '0.0"%"');
  kpiTile(
    dash,
    "E5:F6",
    "E7:F7",
    "OOS RATE",
    `COUNTIF('Raw Data'!H2:H${lastRawRow},"Yes")/COUNTA('Raw Data'!H2:H${lastRawRow})`,
    RED,
    "0%"
  );
  kpiTile(dash, "G5:H6", "G7:H7", "AVG POSITIONING SCORE", `AVERAGE('Raw Data'!N2:N${lastRawRow})`, GREEN, "0.00");
  kpiTile(
    dash,
    "I5:J6",
    "I7:J7",
    "DELIVERY RATE",
    `COUNTIF('Raw Data'!P2:P${lastRawRow},"Order Delivered")/COUNTA('Raw Data'!P2:P${lastRawRow})`,
    AMBER,
    "0%"
  );
  kpiTile(
    dash,
    "K5:L6",
    "K7:L7",
    "COMPETITOR ACTIVITY",
    `COUNTIF('Raw Data'!J2:J${lastRawRow},"Yes")/COUNTA('Raw Data'!J2:J${lastRawRow})`,
    NAVY,
    "0%"
  );

  dash.mergeCells("A10:D10");
  const poTitle = dash.getCell("A10");
  poTitle.value = "PURCHASE ORDER STATUS";
  poTitle.font = { name: "Arial", size: 12, bold: true, color: { argb: NAVY } };

  dash.mergeCells("F10:I10");
  const deliveryTitle = dash.getCell("F10");
  deliveryTitle.value = "DELIVERY STATUS";
  deliveryTitle.font = { name: "Arial", size: 12, bold: true, color: { argb: NAVY } };

  for (const [cellRef, text] of [
    ["A11", "Status"],
    ["B11", "Count"],
    ["F11", "Status"],
    ["G11", "Count"],
  ] as const) {
    const cell = dash.getCell(cellRef);
    cell.value = text;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
    cell.alignment = { horizontal: "center" };
  }

  const poStatuses = ["Fulfilled", "Pending", "No PO Raised"];
  poStatuses.forEach((status, i) => {
    const r = 12 + i;
    dash.getCell(`A${r}`).value = status;
    dash.getCell(`B${r}`).value = { formula: `COUNTIF('Raw Data'!O2:O${lastRawRow},A${r})` };
  });
  dash.getCell("A15").value = "Total P.O. Value (KES)";
  dash.getCell("A15").font = { name: "Arial" };
  dash.getCell("B15").value = { formula: `SUM('Raw Data'!Q2:Q${lastRawRow})` };
  dash.getCell("B15").numFmt = "#,##0.00";

  const deliveryStatuses = ["Order Delivered", "Not Delivered"];
  deliveryStatuses.forEach((status, i) => {
    const r = 12 + i;
    dash.getCell(`F${r}`).value = status;
    dash.getCell(`G${r}`).value = { formula: `COUNTIF('Raw Data'!P2:P${lastRawRow},F${r})` };
  });

  dash.getColumn(1).width = 11;
  dash.getColumn(6).width = 14;
  dash.getColumn(7).width = 11;

  // ---------------- Perf sheets ----------------
  const merchNames = countDistinctByFrequency(rawRows.map((r) => r.merchandiser));
  const retailerNames = countDistinctByFrequency(rawRows.map((r) => r.retailer));
  const regionNames = countDistinctByFrequency(rawRows.map((r) => r.region));

  buildPerfSheet(workbook, "Merchandiser Perf", "Merchandiser", "C", merchNames, lastRawRow);
  buildPerfSheet(workbook, "Retailer Perf", "Retailer", "D", retailerNames, lastRawRow);
  buildPerfSheet(workbook, "Region Perf", "Region", "E", regionNames, lastRawRow);

  // ---------------- OOS Detail ----------------
  const oosSheet = workbook.addWorksheet("OOS Detail");
  const oosTitle = oosSheet.getCell("A1");
  oosTitle.value = "Out-of-Stock Incident Log";
  oosTitle.font = { name: "Arial", size: 12, bold: true, color: { argb: NAVY } };

  const oosHeaders = ["Visit Date", "Merchandiser", "Retailer", "Branch", "Region", "OOS Item(s) Reported"];
  const oosHeaderRow = oosSheet.getRow(3);
  oosHeaders.forEach((h, i) => {
    const cell = oosHeaderRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } };
  });
  const oosRows = rawRows.filter((r) => r.oos === "Yes");
  oosRows.forEach((r, i) => {
    const row = oosSheet.getRow(4 + i);
    row.getCell(1).value = r.date;
    row.getCell(1).numFmt = "yyyy\\-mm\\-dd";
    row.getCell(2).value = r.merchandiser;
    row.getCell(3).value = r.retailer;
    row.getCell(4).value = r.branch;
    row.getCell(5).value = r.region;
    row.getCell(6).value = r.oosItems || "Not itemized";
  });
  const oosWidths = [12, 14, 26, 22, 14, 60];
  oosWidths.forEach((w, i) => (oosSheet.getColumn(i + 1).width = w));

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}
