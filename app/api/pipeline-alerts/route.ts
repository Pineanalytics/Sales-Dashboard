import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendPipelineRunEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Internal "a scheduled pipeline run just finished" webhook — not a vendor
 * integration like the app/api/integrations/* routes, but the same shape:
 * the two standalone scripts that have no SMTP credentials of their own
 * (scripts/db-bridge/sales-returns/run.ts on the Centegy machine, and
 * scripts/ukl-sales-export-pull.ps1 on the D:\UKL_INTEGRATION\UPLOADS
 * server) POST a short report here, and this route emails it via the app's
 * existing Gmail SMTP (lib/email.ts) — so the SMTP password never has to be
 * copied onto either of those machines. Fires on every run, success or
 * failure, per user request.
 */

const DEFAULT_ALERT_EMAIL = "analytics@pinefrost.co.ke";

function hasValidKey(request: NextRequest) {
  const expected = process.env.PIPELINE_ALERT_KEY;
  const provided = request.headers.get("x-pipeline-alert-key");
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: NextRequest) {
  if (!hasValidKey(request)) {
    return NextResponse.json({ error: "Invalid pipeline alert credentials." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.task !== "string" || (body.status !== "success" && body.status !== "failure")) {
    return NextResponse.json({ error: 'Body must include "task" (string) and "status" ("success" | "failure").' }, { status: 400 });
  }

  const result = await sendPipelineRunEmail({
    to: process.env.PIPELINE_ALERT_EMAIL || DEFAULT_ALERT_EMAIL,
    task: body.task,
    machine: typeof body.machine === "string" ? body.machine : undefined,
    status: body.status,
    summary: typeof body.summary === "string" ? body.summary : "",
  });

  return NextResponse.json(result, { status: result.sent ? 200 : 502 });
}
