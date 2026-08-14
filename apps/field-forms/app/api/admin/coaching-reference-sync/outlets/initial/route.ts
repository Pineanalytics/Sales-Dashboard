import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function canManageForm(formId: string) {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return false;
  const { data: viewer } = await sessionClient
    .from("profiles")
    .select("role, assigned_form_id")
    .eq("id", user.id)
    .single();
  return viewer?.role === "super_admin" || (viewer?.role === "admin" && viewer.assigned_form_id === formId);
}

export async function GET(request: Request) {
  const formId = new URL(request.url).searchParams.get("formId");
  if (!formId) return NextResponse.json({ error: "A form is required." }, { status: 400 });
  if (!(await canManageForm(formId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await createAdminClient()
    .from("coaching_reference_sync_runs")
    .select("id, status, message, stats, started_at, completed_at, created_at")
    .eq("form_id", formId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Outlet-sync tracking is not available yet." }, { status: 503 });
  return NextResponse.json({ run: data ?? null });
}

export async function POST(request: Request) {
  const { formId } = (await request.json()) as { formId?: unknown };
  if (typeof formId !== "string") return NextResponse.json({ error: "Invalid outlet refresh request." }, { status: 400 });
  if (!(await canManageForm(formId))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: activeRun, error: activeRunError } = await admin
    .from("coaching_reference_sync_runs")
    .select("id, status")
    .eq("form_id", formId)
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeRunError) return NextResponse.json({ error: "Outlet-sync tracking is not available yet." }, { status: 503 });
  if (activeRun) return NextResponse.json({ ok: true, runId: activeRun.id, status: activeRun.status, alreadyRunning: true });

  const runId = randomUUID();
  const { error: createError } = await admin.from("coaching_reference_sync_runs").insert({
    id: runId,
    form_id: formId,
    status: "queued",
    message: "Initial outlet reconciliation is queued.",
  });
  if (createError) return NextResponse.json({ error: "Could not queue the controlled outlet refresh." }, { status: 503 });

  const child = spawn(process.execPath, ["scripts/coaching-initial-outlet-sync.mjs"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: { ...process.env, COACHING_SYNC_FORM_ID: formId, COACHING_SYNC_RUN_ID: runId },
  });
  child.unref();
  return NextResponse.json({ ok: true, runId, status: "queued" }, { status: 202 });
}
