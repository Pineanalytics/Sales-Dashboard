import { NextRequest, NextResponse } from "next/server";
import { generateReportNarrative } from "@/lib/reports/narrative";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

interface NarrativeRequestBody {
  title?: string;
  summary?: { label: string; value: string }[];
  sections?: { title: string; columns: string[]; rows: (string | number)[][] }[];
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let body: NarrativeRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.title !== "string" || !Array.isArray(body.sections)) {
    return NextResponse.json({ error: "Expected { title, summary?, sections }." }, { status: 400 });
  }

  try {
    const narrative = await generateReportNarrative({ title: body.title, summary: body.summary, sections: body.sections });
    return NextResponse.json({ narrative });
  } catch (err) {
    console.error("Failed to generate report narrative", err);
    return NextResponse.json({ error: "Couldn't generate a summary for this report — try again in a moment." }, { status: 500 });
  }
}
