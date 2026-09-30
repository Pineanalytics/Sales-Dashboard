import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { upsertAgeingSnapshot } from "@/lib/receivablesAgeing";

export const runtime = "nodejs";

type ItemRow = { dueDate: string; openBalance: number };

function validApiKey(req: NextRequest) {
  const expected = process.env.UPLOAD_API_KEY;
  const provided = req.headers.get("x-upload-api-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

function validItem(row: unknown): row is ItemRow {
  const r = row as Record<string, unknown>;
  return !!r && isDate(r.dueDate) && isFiniteNumber(r.openBalance);
}

/** Lists every stored snapshot date + its isApproximate flag, so the
 *  historical-ageing backfill script can skip dates that already have a real
 *  (non-approximate) snapshot instead of re-querying SAP's reconciliation
 *  history for them every time it runs — that query takes several seconds
 *  per date, so re-running it for dates already fixed would make repeat
 *  backfill runs pointlessly slow. */
export async function GET(req: NextRequest) {
  if (!validApiKey(req)) return NextResponse.json({ error: "Invalid receivables sync credential." }, { status: 401 });
  const rows = await prisma.receivablesAgeingSnapshot.findMany({ select: { snapshotDate: true, isApproximate: true }, orderBy: { snapshotDate: "asc" } });
  return NextResponse.json({ snapshots: rows.map((r) => ({ snapshotDate: r.snapshotDate.toISOString(), isApproximate: r.isApproximate })) });
}

/** Upserts a single real (replay-reconstructed) historical ageing snapshot —
 *  see scripts/db-bridge/receivables/historicalAgeing.ts for how the items
 *  are computed. Always writes isApproximate: false; this route is never
 *  used for the old today's-still-open-items approximation. */
export async function POST(req: NextRequest) {
  if (!validApiKey(req)) return NextResponse.json({ error: "Invalid receivables sync credential." }, { status: 401 });

  const body: unknown = await req.json().catch(() => null);
  const payload = body as { snapshotDate?: unknown; items?: unknown } | null;
  if (!payload || !isDate(payload.snapshotDate) || !Array.isArray(payload.items) || !payload.items.every(validItem)) {
    return NextResponse.json({ error: "Invalid ageing snapshot payload." }, { status: 400 });
  }

  const snapshotDate = new Date(payload.snapshotDate as string);
  const items = (payload.items as ItemRow[]).map((row) => ({ dueDate: new Date(row.dueDate), openBalance: row.openBalance }));

  try {
    await upsertAgeingSnapshot(prisma, snapshotDate, items, false);
    return NextResponse.json({ snapshotDate: snapshotDate.toISOString(), itemCount: items.length });
  } catch (error) {
    console.error("Failed to save historical ageing snapshot", error);
    return NextResponse.json({ error: "Failed to save ageing snapshot." }, { status: 500 });
  }
}
