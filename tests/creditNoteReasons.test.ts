import { createElement } from "react";
import { renderToString } from "react-dom/server";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildReasonReport, classifyReason, typedRemark, type ReasonId, type ReasonRow } from "../lib/creditNotes/reasons";
import { buildReasonSheets } from "../lib/creditNotes/reasonsWorkbook";
import { extractToXlsxBuffer } from "../lib/extractWorkbook";
import { ReasonsReportView } from "../components/creditNotes/ReasonsSection";

describe("the typed part of the Remarks", () => {
  it("drops the text SAP and linked systems add by themselves", () => {
    expect(typedRemark("Based on Sales Orders 20000439.Discount percentage deviates from discount total due to rounding * Based on AR Invoices 60023444.")).toBe("");
    expect(typedRemark("UPField Invoice No : OI-0810-200727-6228177; Printed By : api Based On A/R Invoices 818500.")).toBe("");
    expect(typedRemark("Sales Edge Van Sales Credit Note No : 2284; Printed By : api")).toBe("");
    expect(typedRemark("no cash Based On A/R Invoices 3109512.")).toBe("no cash");
    expect(typedRemark("Based On Sales Orders 8185959. -short expiry")).toBe("short expiry");
  });

  it("is empty for blank remarks, bare numbers and single letters", () => {
    for (const text of [null, undefined, "", "   ", "2643. 2644. 2645.", "o/s"]) expect(typedRemark(text)).toBe("");
  });
});

describe("the reason groups", () => {
  const cases: [ReasonId, string[]][] = [
    ["payment", ["no cash", "less cash", "noo cash", "no cxash", "no caah", "insufficient funds", "bounced chq", "PENDING PAYMENT", "late payment", "partial rtn no cash", "exceeded credit limit", "no chq"]],
    ["shop", ["SHOP CLOSED", "shop closd", "shop cl;osed", "location not found", "offroute", "road inaccesible", "owner not available"]],
    ["late", ["LATE DELIVERY", "late dlivery", "delayed order", "latedelivery"]],
    ["declined", ["NOT ORDERED", "not orderred", "not odered", "order cancelled", "refused order", "customer declined"]],
    ["order", ["wrong sku", "wrong order", "to reduce order", "excess supply", "wanted 6pcs not 12", "customer ordered 24pcs not 24cases"]],
    ["stockout", ["oos", "out of stock", "out of stocjk", "partial rtn oos"]],
    ["undelivered", ["not on loading sheet", "NOT RECEIVED", "not dispatched"]],
    ["stocked", ["overstocked", "slow moving", "already stocked", "bought elsewhere"]],
    ["duplicate", ["double inv.", "double order", "booked twice", "duplicated sku"]],
    ["lpo", ["not in lpo", "expired lpo"]],
    ["expiry", ["short expiry", "damage", "empty cans", "broken seal", "no expiry date", "Expiry sorted by swell allowance for the period April 2026"]],
    ["price", ["price issue", "NO DISCOUNT", "to rebook with disc", "no offer"]],
    ["promo", ["{4P} JBP PAYOUT Q1 YR 2026", "BB promo claim from 17th to 30th July", "PET FEB AND MARCH SHORT BOGOF 2026", "Q2 2025 rebate", "June TTS"]],
    ["account", ["wrong pin", "acc name", "to rebook under customer acc", "printer error", "wrong series to rebook"]],
    ["rebook", ["to rebook", "to combine invoice", "rebooked", "to reinvoice"]],
    ["recon", ["stock reconciliation", "P5 closing period 16/05/26"]],
    ["partial", ["partial rtn", "P/RTN", "full return"]],
    ["other", ["dunga", "pending", "held"]],
  ];

  it.each(cases)("reads %s", (id, remarks) => {
    for (const remark of remarks) expect([remark, classifyReason(remark).id]).toEqual([remark, id]);
  });

  it("separates a note nobody explained from one a linked system posted", () => {
    expect(classifyReason(null)).toEqual({ id: "none", typed: "" });
    expect(classifyReason("Based on Sales Orders 13012952.").id).toBe("none");
    // An invoice's reference carried onto a credit note typed in SAP is still a missing reason.
    expect(classifyReason("UPField Invoice No : OI-1046-191696-6011344; Printed By : api Based on Sales Orders 817599").id).toBe("none");
    expect(classifyReason("UKL Credit Note No : 26K007000221_T005400700100064348_18058585").id).toBe("system");
    expect(classifyReason("EABL Credit Note No : CNPFL022016012").id).toBe("system");
  });
});

const row = (over: Partial<ReasonRow>): ReasonRow => ({
  docEntry: 1, docNum: "100", date: "2026-10-05", customerCode: "C-1", customerName: "Shop One", rep: "Rep A", principal: "Mars", enteredBy: "Clerk A", remarks: "no cash", credit: 1000, ...over,
});

const rows: ReasonRow[] = [
  row({}),
  // The same credit note under a second principal: one document, both values.
  row({ principal: "EABL", credit: 500 }),
  row({ docEntry: 2, docNum: "101", date: "2026-11-02", customerCode: "C-2", customerName: "Shop Two", remarks: "SHOP CLOSED", credit: 300 }),
  row({ docEntry: 3, docNum: "102", date: "2026-11-03", enteredBy: "Clerk B", remarks: "Based on Sales Orders 13012952.", credit: 2000 }),
  row({ docEntry: 4, docNum: "103", date: "2026-11-04", enteredBy: "Link", remarks: "UKL Credit Note No : 26NY0_1", credit: 200 }),
  // Outside the months asked for, and a note that nets to nothing.
  row({ docEntry: 5, docNum: "90", date: "2026-08-04", credit: 9999 }),
  row({ docEntry: 6, docNum: "104", credit: 0 }),
];

describe("the reasons report", () => {
  const report = buildReasonReport(rows, { months: ["2026-10", "2026-11"] });

  it("totals the credit and counts each credit note once", () => {
    expect(report.total).toEqual({ credit: 4000, documents: 4 });
    expect(report.typed).toEqual({ credit: 1800, documents: 2 });
    expect(report.untyped).toEqual({ credit: 2200, documents: 2 });
    expect(report.system).toEqual({ credit: 200, documents: 1 });
    expect(report.reasons.map((r) => [r.id, r.credit, r.documents])).toEqual([["none", 2000, 1], ["payment", 1500, 1], ["shop", 300, 1], ["system", 200, 1]]);
    expect(report.reasons.find((r) => r.id === "payment")).toMatchObject({ m: [1500, 0], customers: 1, topPrincipal: "Mars", share: 37.5 });
  });

  it("shows who leaves the reason out and each principal's main reason", () => {
    expect(report.enteredBy.map((r) => [r.name, r.untypedDocuments, r.untypedCredit, Math.round(r.typedShare), r.topReason])).toEqual([
      ["Clerk B", 1, 2000, 0, ""],
      ["Clerk A", 0, 0, 100, "Payment or credit limit"],
      ["Link", 1, 200, 0, ""],
    ]);
    expect(report.principals.map((r) => [r.name, r.credit, r.documents, r.topReason])).toEqual([
      ["Mars", 3500, 4, "Payment or credit limit"],
      ["EABL", 500, 1, "Payment or credit limit"],
    ]);
  });

  it("lists the credit notes with the remark as typed, largest first", () => {
    expect(report.documents.map((d) => [d.docNum, d.credit, d.reasonId, d.remark, d.principal])).toEqual([
      ["102", 2000, "none", "", "Mars"],
      ["100", 1500, "payment", "no cash", "EABL, Mars"],
      ["101", 300, "shop", "SHOP CLOSED", "Mars"],
      ["103", 200, "system", "", "Mars"],
    ]);
    const cut = buildReasonReport([row({}), row({ docEntry: 7, docNum: "105", credit: 10 })], { months: ["2026-10"], documentsPerReason: 1, topCustomers: 0 });
    expect(cut.documents.map((d) => d.docNum)).toEqual(["100"]);
    expect(cut.customers).toEqual([]);
    expect(cut.customerCount).toBe(1);
  });

  it("writes the Excel sheets", () => {
    const sheets = buildReasonSheets(report, ["2025-12"]);
    expect(sheets.map((s) => s.name)).toEqual(["Reasons", "Reasons By Principal", "Reasons By Month", "Reasons Entered By", "Reasons By Rep", "Reasons By Customer", "Credit Note Reasons"]);
    for (const sheet of sheets) for (const line of sheet.rows) expect(line).toHaveLength(sheet.columns.length);
    expect(sheets[6].rows).toHaveLength(4);
    const book = XLSX.read(extractToXlsxBuffer(sheets), { type: "buffer", cellNF: true });
    expect(book.Sheets["Reasons By Principal"]["D2"].z).toBe("#,##0.00");
    expect(buildReasonSheets(null, ["2025-12"])[0].rows).toEqual([["Reasons are not stored for 2025-12."]]);
  });

  it("renders the tab", () => {
    const html = renderToString(createElement(ReasonsReportView, { report }));
    for (const text of ["Why credit notes were issued", "Payment or credit limit", "No reason typed", "Who entered them", "As typed in SAP", "SHOP CLOSED"]) expect(html).toContain(text);
  });
});
