import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { isRosterRow, upsertRosterRows, type RosterUploadRow, type RosterFormat } from "@/lib/rosterImport";

export const runtime = "nodejs";

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/** Receives a vetted Roster import from Target_Management_System.xlsm
 *  (scripts/target-management/import.ts) or the browser CSV upload
 *  (admin/team-leaders/actions.ts's uploadRosterCsvAction) — both funnel through
 *  lib/rosterImport.ts's shared parse/upsert logic, so this route and the in-process
 *  admin action stay behaviorally identical. */
export async function POST(req: NextRequest) {
  if (!hasValidApiKey(req)) {
    return NextResponse.json({ error: "Invalid or missing x-upload-api-key." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with a "rows" array.' }, { status: 400 });
  }

  const rows = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '"rows" must be a non-empty array.' }, { status: 400 });
  }
  if (!rows.every(isRosterRow)) {
    return NextResponse.json({ error: "One or more Roster rows are invalid." }, { status: 400 });
  }
  const validRows = rows as RosterUploadRow[];
  const formatRaw = (body as { format?: unknown })?.format;
  const format: RosterFormat = formatRaw === "V18" ? "V18" : "V21"; // defaults to V21 so scripts/target-management/import.ts's .xlsm path (which never sends this) keeps working unmodified

  try {
    const result = await upsertRosterRows(validRows, format);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("Failed to import Roster", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to save Roster data.", detail }, { status: 500 });
  }
}
