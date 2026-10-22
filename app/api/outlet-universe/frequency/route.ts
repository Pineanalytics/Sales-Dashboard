import { NextRequest, NextResponse } from "next/server";
import { resolveOutletAccess } from "@/lib/outletUniverse/access";
import { loadFrequencyReport, resolveFrequencyPeriod } from "@/lib/outletUniverse/frequency";
import { frequencyCsv, frequencyFileStem, frequencyWorkbook } from "@/lib/outletUniverse/frequencyExport";
import { parseOutletFilters } from "@/lib/outletUniverse/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One extract is built at a time: a year holds about 60,000 outlets and the Excel build alone needs about half a gigabyte, so two at once would be a lot to ask of the app. */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** The filters that narrow the extract, as short phrases for the workbook's notes. */
function filterNotes(params: URLSearchParams): string[] {
  const notes: string[] = [];
  for (const [key, label] of [["source", "system"], ["role", "role"], ["principal", "principal"], ["principalKey", "principal brand"], ["channel", "channel"], ["segment", "segment"], ["region", "region"], ["territory", "territory"], ["route", "route"], ["rep", "rep"], ["q", "search"]] as const) {
    const value = (params.get(key) ?? "").trim();
    if (value) notes.push(`${label} = ${value.slice(0, 80)}`);
  }
  return notes;
}

/** Coverage frequency for one period (kind = year | quarter | month | week, with year, quarter, month or week): the outlets that bought in it and
 *  how often, as an Excel workbook (summary + raw rows + notes, format=xlsx, the default), the raw rows as CSV (format=csv), or the summary as JSON
 *  (format=json). Narrowed by the same filters as the Active Outlets screen, within the session's own principals. */
export async function GET(req: NextRequest) {
  const access = await resolveOutletAccess();
  if (!access.ok) return NextResponse.json({ error: "Sign in required." }, { status: access.status });
  try {
    const params = req.nextUrl.searchParams;
    const format = params.get("format");
    const period = resolveFrequencyPeriod(params);
    const filters = parseOutletFilters(params);
    // The files are built inside the queue (the Excel build is the heavy part); the JSON preview only holds the summary, so it is queued for the load alone.
    if (format !== "json" && format !== "csv") {
      return await oneAtATime(async () => {
        const report = await loadFrequencyReport(period, filters, access.scope);
        return new NextResponse(new Uint8Array(frequencyWorkbook(report, filterNotes(params))), {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="${frequencyFileStem(report)}.xlsx"`,
            "Cache-Control": "private, no-store",
          },
        });
      });
    }
    const report = await oneAtATime(() => loadFrequencyReport(period, filters, access.scope));
    if (format === "csv") {
      return new NextResponse(`﻿${frequencyCsv(report.outlets)}`, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${frequencyFileStem(report)}.csv"`, "Cache-Control": "private, no-store" },
      });
    }
    return NextResponse.json({ period: { kind: report.period.kind, year: report.period.year, quarter: report.period.quarter, month: report.period.month, week: report.period.week, label: report.period.label }, outletCount: report.outlets.length, summary: report.summary, generatedAt: report.generatedAt }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to build the coverage frequency extract", error);
    return NextResponse.json({ error: "Failed to build the coverage frequency extract." }, { status: 500 });
  }
}
