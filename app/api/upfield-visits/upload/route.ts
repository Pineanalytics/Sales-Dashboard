import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { validateUpfieldVisitUploadBatch } from "@/lib/upfieldIngestion";

export const runtime = "nodejs";

class IngestionConflict extends Error {}

function hasValidBearerToken(req: NextRequest): boolean {
  const expected = process.env.UPFIELD_TIMESTAMP_UPLOAD_KEY;
  const header = req.headers.get("authorization");
  if (!expected || !header) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(match[1]);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

function payloadHash(records: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

export async function POST(req: NextRequest) {
  if (!hasValidBearerToken(req)) {
    return NextResponse.json({ error: "Invalid or missing Upfield Visit bearer token." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  const validation = validateUpfieldVisitUploadBatch(body);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 422 });

  const { batch, windowStart, windowEnd } = validation;
  const hash = payloadHash(batch.records);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        let run = await tx.upfieldSyncRun.findUnique({ where: { syncRunId: batch.syncRunId } });
        if (!run) {
          if (batch.batchNumber !== 1) throw new IngestionConflict("The first accepted batch for a syncRunId must be batch 1.");
          run = await tx.upfieldSyncRun.create({
            data: { syncRunId: batch.syncRunId, source: batch.source, windowStart, windowEnd },
          });
        }
        if (run.source !== batch.source || run.windowStart.getTime() !== windowStart.getTime() || run.windowEnd.getTime() !== windowEnd.getTime()) {
          throw new IngestionConflict("syncRunId was already used with different source/window metadata.");
        }

        const received = await tx.upfieldSyncBatch.findUnique({
          where: { syncRunId_batchNumber: { syncRunId: batch.syncRunId, batchNumber: batch.batchNumber } },
        });
        if (received) {
          if (received.payloadHash !== hash) throw new IngestionConflict("This syncRunId/batchNumber was already accepted with different content.");
          return { duplicateBatch: true, completed: run.status === "COMPLETE", totalRecords: run.recordCount };
        }
        if (run.status === "COMPLETE") throw new IngestionConflict("This syncRunId is already complete and cannot accept another batch.");
        if (batch.batchNumber !== run.lastBatchNumber + 1) {
          throw new IngestionConflict(`Expected batch ${run.lastBatchNumber + 1}, received batch ${batch.batchNumber}.`);
        }

        if (batch.records.length > 0) {
          const values = batch.records.map((row) => Prisma.sql`(
            ${row.sourceRecordId}, ${row.fsr}, ${row.distributor}, ${row.pop},
            ${new Date(row.startTime)}, ${row.endTime ? new Date(row.endTime) : null},
            ${row.timeInOutlet}, ${row.transitTime}, ${row.lppc}, ${row.sale},
            ${row.sourceFile}, ${batch.syncRunId}, now(), now()
          )`);
          await tx.$executeRaw`
            INSERT INTO "UpfieldVisit" (
              "sourceRecordId", fsr, distributor, pop, "startTime", "endTime",
              "timeInOutlet", "transitTime", lppc, sale, "sourceFile",
              "lastSeenSyncRunId", "createdAt", "updatedAt"
            ) VALUES ${Prisma.join(values)}
            ON CONFLICT ("sourceRecordId") DO UPDATE SET
              fsr = EXCLUDED.fsr,
              distributor = EXCLUDED.distributor,
              pop = EXCLUDED.pop,
              "startTime" = EXCLUDED."startTime",
              "endTime" = EXCLUDED."endTime",
              "timeInOutlet" = EXCLUDED."timeInOutlet",
              "transitTime" = EXCLUDED."transitTime",
              lppc = EXCLUDED.lppc,
              sale = EXCLUDED.sale,
              "sourceFile" = EXCLUDED."sourceFile",
              "lastSeenSyncRunId" = EXCLUDED."lastSeenSyncRunId",
              "updatedAt" = now()
          `;
        }

        await tx.upfieldSyncBatch.create({
          data: { syncRunId: batch.syncRunId, batchNumber: batch.batchNumber, payloadHash: hash, recordCount: batch.recordCount },
        });
        const nextRecordCount = run.recordCount + batch.recordCount;
        if (!batch.isFinalBatch) {
          await tx.upfieldSyncRun.update({
            where: { syncRunId: batch.syncRunId },
            data: { lastBatchNumber: batch.batchNumber, recordCount: nextRecordCount },
          });
          return { duplicateBatch: false, completed: false, totalRecords: nextRecordCount };
        }

        const batches = await tx.upfieldSyncBatch.findMany({
          where: { syncRunId: batch.syncRunId },
          select: { batchNumber: true },
          orderBy: { batchNumber: "asc" },
        });
        if (batches.length !== batch.batchNumber || batches.some((item, index) => item.batchNumber !== index + 1)) {
          throw new IngestionConflict("Final batch cannot complete the run because one or more earlier batches are missing.");
        }
        const completedAt = new Date();
        await tx.upfieldSyncRun.update({
          where: { syncRunId: batch.syncRunId },
          data: {
            status: "COMPLETE",
            lastBatchNumber: batch.batchNumber,
            finalBatchNumber: batch.batchNumber,
            recordCount: nextRecordCount,
            completedAt,
          },
        });
        await tx.syncWatermark.upsert({
          where: { bridge: "upfield-visits" },
          create: { bridge: "upfield-visits", lastIncrementalAt: windowEnd },
          update: { lastIncrementalAt: windowEnd },
        });
        return { duplicateBatch: false, completed: true, totalRecords: nextRecordCount };
      },
      { timeout: 30_000 }
    );

    return NextResponse.json({
      ok: true,
      source: batch.source,
      syncRunId: batch.syncRunId,
      batchNumber: batch.batchNumber,
      acceptedRecords: batch.recordCount,
      totalRecords: result.totalRecords,
      duplicateBatch: result.duplicateBatch,
      completed: result.completed,
    });
  } catch (error) {
    if (error instanceof IngestionConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Failed to ingest Upfield Visit batch", error);
    return NextResponse.json({ error: "Failed to save Upfield visit data." }, { status: 500 });
  }
}
