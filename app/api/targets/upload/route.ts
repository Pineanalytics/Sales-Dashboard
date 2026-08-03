import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { invalidateDatasetCache } from "@/lib/datasetStore";

export const runtime = "nodejs";

interface TargetUploadRow {
  year: string;
  month: string;
  monthIndex: number;
  principal: string;
  mainPrincipal: string | null;
  valueTarget: number | null;
  volumeTarget: number | null;
  coverageTarget: number | null;
  productivityTarget: number | null;
}

function hasValidApiKey(req: NextRequest): boolean {
  const expected = process.env.UPLOAD_API_KEY;
  if (!expected) return false;
  const provided = req.headers.get("x-upload-api-key");
  if (!provided) return false;
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isTargetRow(value: unknown): value is TargetUploadRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isText(row.year) &&
    isText(row.month) &&
    typeof row.monthIndex === "number" &&
    Number.isInteger(row.monthIndex) &&
    isText(row.principal) &&
    isNullableText(row.mainPrincipal) &&
    isNullableNumber(row.valueTarget) &&
    isNullableNumber(row.volumeTarget) &&
    isNullableNumber(row.coverageTarget) &&
    isNullableNumber(row.productivityTarget)
  );
}

// Same shape and SQL as upsertTargetsChunk in app/(protected)/admin/targets/
// actions.ts's bulk upload path — duplicated here rather than shared, since
// that file is a "use server" actions module (every export must be an async
// server action) and can't cleanly export a plain helper for a route to import.
const CHUNK_SIZE = 500;

async function upsertTargetsChunk(rows: TargetUploadRow[]) {
  const values = rows.map(
    (row) =>
      Prisma.sql`(${randomUUID()}, ${row.year}, ${row.month}, ${row.monthIndex}, ${row.principal}, ${row.mainPrincipal}, ${row.valueTarget}, ${row.volumeTarget}, ${row.coverageTarget}, ${row.productivityTarget}, now(), now())`
  );

  await prisma.$executeRaw`
    INSERT INTO "Target" (id, year, month, "monthIndex", principal, "mainPrincipal", "valueTarget", "volumeTarget", "coverageTarget", "productivityTarget", "createdAt", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT (year, month, principal)
    DO UPDATE SET
      "monthIndex" = EXCLUDED."monthIndex",
      "mainPrincipal" = EXCLUDED."mainPrincipal",
      "valueTarget" = EXCLUDED."valueTarget",
      "volumeTarget" = EXCLUDED."volumeTarget",
      "coverageTarget" = EXCLUDED."coverageTarget",
      "productivityTarget" = EXCLUDED."productivityTarget",
      "updatedAt" = now()
  `;
}

/** Headless counterpart to admin/targets/actions.ts's uploadTargetsAction (a
 *  browser file-upload form, ADMIN session only) — lets
 *  scripts/target-management/import.ts bulk-upsert Target rows the same way,
 *  API-key gated like every other bridge upload route. */
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
  if (!rows.every(isTargetRow)) {
    return NextResponse.json({ error: "One or more Target rows are invalid." }, { status: 400 });
  }
  const validRows = rows as TargetUploadRow[];

  try {
    for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
      await upsertTargetsChunk(validRows.slice(i, i + CHUNK_SIZE));
    }
    invalidateDatasetCache();
    return NextResponse.json({ targets: validRows.length }, { status: 200 });
  } catch (err) {
    console.error("Failed to import Targets", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "Failed to save Target data.", detail }, { status: 500 });
  }
}
