import Anthropic from "@anthropic-ai/sdk";
import type { ReportContent } from "./types";

const MODEL = "claude-sonnet-5";
const MAX_ROWS_PER_SECTION = 20; // caps prompt size on large reports — the narrative only needs enough rows to spot a pattern, not the full table

/** Writes a short executive commentary for a downloaded report, from the exact
 *  table/summary data ReportCatalog.tsx already built — never re-derives or
 *  invents a figure. Report definitions (lib/reports/definitions.ts) never
 *  call this themselves; it's a separate, opt-in step the user triggers per
 *  download (see the "Include AI summary" toggle in ReportCatalog.tsx). */
export async function generateReportNarrative(report: Pick<ReportContent, "title" | "summary" | "sections">): Promise<string> {
  const client = new Anthropic();

  const compactSections = report.sections.map((s) => ({
    title: s.title,
    columns: s.columns,
    rows: s.rows.slice(0, MAX_ROWS_PER_SECTION),
    truncated: s.rows.length > MAX_ROWS_PER_SECTION,
  }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system:
      "You write short executive commentary for a Kenyan FMCG distributor's business reports. " +
      "Use only the figures given — never estimate, round oddly, or invent a number. Write 3-5 " +
      "sentences of plain business prose, no headers, no bullet points, no markdown.",
    messages: [
      {
        role: "user",
        content: `Report: ${report.title}\n\nSummary: ${JSON.stringify(report.summary ?? [])}\n\nSections:\n${JSON.stringify(compactSections)}\n\nWrite the commentary.`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
}
