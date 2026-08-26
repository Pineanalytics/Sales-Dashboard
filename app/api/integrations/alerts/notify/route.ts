import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendOpsAlertEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Failure-notification sink for the Windows-scheduled sync scripts that have
 * no SMTP credentials of their own: scripts/sales-returns-sync.ps1 (Centegy
 * machine) and scripts/ukl-sales-export-pull.ps1 (the UKL_INTEGRATION\UPLOADS
 * server). Both POST here from their `catch` blocks on failure, reusing the
 * UPLOAD_API_KEY they already hold — no new credentials needed on either
 * machine. This route just forwards to sendOpsAlertEmail (lib/email.ts),
 * which is a no-op (not an error) if SMTP/recipients aren't configured yet,
 * so a missing mail setup never breaks the calling script's own error
 * handling — the original failure is what matters, this is best-effort on
 * top of it.
 */

function hasValidKey(request: NextRequest) {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = request.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: NextRequest) {
  if (!hasValidKey(request)) {
    return NextResponse.json({ error: "Invalid or missing API key." }, { status: 401 });
  }

  let body: { source?: unknown; subject?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Expected JSON with "source", "subject", and "message".' }, { status: 400 });
  }
  if (typeof body.source !== "string" || typeof body.subject !== "string" || typeof body.message !== "string") {
    return NextResponse.json({ error: '"source", "subject", and "message" must all be strings.' }, { status: 400 });
  }

  const result = await sendOpsAlertEmail(`${body.source}: ${body.subject}`, body.message);
  return NextResponse.json(result);
}
