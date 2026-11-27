// The credit-note reasons as sheets added to the Credit Notes & Returns workbook: the totals by reason, principal, month and
// author, and every credit note with its reason and the remark as typed.
import type { ExtractCell, ExtractSheet } from "@/lib/brandCustomerExtract";
import { REASONS, hasTypedReason, reasonLabel, type ReasonGroupRow, type ReasonReport } from "./reasons";

const round = (value: number): number => Math.round(value * 100) / 100;
const share = (part: number, whole: number): number => (whole > 0 ? round((part / whole) * 100) : 0);

export function buildReasonSheets(report: ReasonReport | null, missingMonths: string[]): ExtractSheet[] {
  const note = missingMonths.length > 0 ? `Reasons are not stored for ${missingMonths.join(", ")}.` : "";
  if (!report) {
    return [{ name: "Reasons", columns: ["Note"], rows: [[note || "No credit notes with stored remarks match this selection."]] }];
  }

  const reasons: ExtractSheet = {
    name: "Reasons",
    columns: ["Reason", "Credit Notes", "Share Of Credit %", "Number", "Customers", "Largest Principal"],
    rows: [
      ...report.reasons.map((row): ExtractCell[] => [row.label, round(row.credit), round(row.share), row.documents, row.customers, row.topPrincipal]),
      ["Total", round(report.total.credit), 100, report.total.documents, "", ""],
      ...(note ? [[note, "", "", "", "", ""] as ExtractCell[]] : []),
    ],
  };

  // Only the reason groups that occur get a column.
  const present = REASONS.filter((reason) => report.reasons.some((row) => row.id === reason.id));
  const principals: ExtractSheet = {
    name: "Reasons By Principal",
    columns: ["Principal", "Credit Notes", "Share With Reason %", ...present.map((reason) => reason.label)],
    rows: report.principals.map((row) => [row.name, round(row.credit), round(row.typedShare), ...present.map((reason) => round(row.byReason[reason.id] ?? 0))]),
  };

  const months: ExtractSheet = {
    name: "Reasons By Month",
    columns: ["Month", "Credit Notes", "Share With Reason %", ...present.map((reason) => reason.label)],
    rows: report.months.map((month, index) => {
      const value = (id: string) => report.reasons.find((row) => row.id === id)?.m[index] ?? 0;
      const all = report.reasons.reduce((sum, row) => sum + row.m[index], 0);
      const typed = report.reasons.filter((row) => hasTypedReason(row.id)).reduce((sum, row) => sum + row.m[index], 0);
      return [month, round(all), share(typed, all), ...present.map((reason) => round(value(reason.id)))];
    }),
  };

  const people = (sheetName: string, label: string, rows: ReasonGroupRow[]): ExtractSheet => ({
    name: sheetName,
    columns: [label, "Number", "Credit Notes", "Without Reason", "Value Without Reason", "Share With Reason %", "Main Reason"],
    rows: rows.map((row) => [row.name, row.documents, round(row.credit), row.untypedDocuments, round(row.untypedCredit), round(row.typedShare), row.topReason]),
  });

  const customers: ExtractSheet = {
    name: "Reasons By Customer",
    columns: ["Customer Code", "Customer", "Number", "Credit Notes", "Without Reason", "Share With Reason %", "Main Reason", ...present.map((reason) => reasonLabel(reason.id))],
    rows: report.customers.map((row) => [row.code ?? "", row.name, row.documents, round(row.credit), row.untypedDocuments, round(row.typedShare), row.topReason, ...present.map((reason) => round(row.byReason[reason.id] ?? 0))]),
  };

  const documents: ExtractSheet = {
    name: "Credit Note Reasons",
    columns: ["Credit Note No", "Doc Date", "Customer Code", "Customer", "Principal", "Sales Rep", "Entered By", "Reason", "Remark As Typed", "Credit Notes"],
    rows: report.documents.map((row) => [row.docNum, row.date, row.customerCode, row.customerName, row.principal, row.rep, row.enteredBy, row.reason, row.remark, round(row.credit)]),
  };

  return [reasons, principals, months, people("Reasons Entered By", "Entered By", report.enteredBy), people("Reasons By Rep", "Sales Rep", report.reps), customers, documents];
}
