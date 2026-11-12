import { prisma } from "./db";
import { isSyncJobName, SYNC_JOB_NAMES, type SyncJobName, type SyncRunState } from "./syncJobs";

// Queue between the "Refresh now" buttons (the app) and the sync workers. The app inserts a
// PENDING row; the worker that owns the job claims it, runs the job straight away and marks it
// COMPLETED or FAILED. Nothing here talks to SAP or Pine.

export interface SyncRunRequestView {
  id: string;
  job: string;
  status: SyncRunState;
  requestedBy: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  resultSummary: string | null;
}

export interface SyncJobRunView {
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastOk: boolean | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

export type RequestOutcome =
  | { ok: true; request: SyncRunRequestView; alreadyActive: boolean }
  | { ok: false; error: string; status: 400 };

/** A request that nothing has claimed after this long is reported as not picked up, not as pending forever. */
export const SYNC_REQUEST_UNCLAIMED_AFTER_MS = 5 * 60_000;
/** A RUNNING request older than this is treated as lost (the worker restarted mid-run). */
export const SYNC_REQUEST_LOST_AFTER_MS = 45 * 60_000;

const ACTIVE: SyncRunState[] = ["PENDING", "RUNNING"];

function view(row: { id: string; job: string; status: string; requestedBy: string | null; requestedAt: Date; startedAt: Date | null; completedAt: Date | null; resultSummary: string | null }): SyncRunRequestView {
  return { ...row, status: row.status as SyncRunState };
}

/** Queue a manual run. A job that is already queued or running is reused rather than queued twice, so a
 *  double click, or two admins at once, cannot stack runs on the shared server. */
export async function requestSyncRun(job: unknown, requestedBy: string | null): Promise<RequestOutcome> {
  if (!isSyncJobName(job)) return { ok: false, error: `"job" must be one of: ${SYNC_JOB_NAMES.join(", ")}.`, status: 400 };
  const existing = await prisma.syncRunRequest.findFirst({
    where: { job, status: { in: ACTIVE }, requestedAt: { gte: new Date(Date.now() - SYNC_REQUEST_LOST_AFTER_MS) } },
    orderBy: { requestedAt: "desc" },
  });
  if (existing) return { ok: true, request: view(existing), alreadyActive: true };
  const created = await prisma.syncRunRequest.create({ data: { job, requestedBy } });
  return { ok: true, request: view(created), alreadyActive: false };
}

/** The newest request per job from the last day, for the panel and for polling. */
export async function getLatestSyncRequests(): Promise<Map<string, SyncRunRequestView>> {
  const rows = await prisma.syncRunRequest.findMany({
    where: { requestedAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    orderBy: { requestedAt: "desc" },
    take: 200,
  });
  const latest = new Map<string, SyncRunRequestView>();
  for (const row of rows) if (!latest.has(row.job)) latest.set(row.job, view(row));
  return latest;
}

export async function getSyncJobRuns(): Promise<Map<string, SyncJobRunView>> {
  const rows = await prisma.syncJobStatus.findMany();
  return new Map(rows.map((row) => [row.job, row] as const));
}

// ---- worker side ----------------------------------------------------------------------------

/** Atomically take the oldest pending request for one of this worker's jobs. SKIP LOCKED keeps two
 *  workers (or two polls) from claiming the same row. */
export async function claimSyncRequest(jobs: readonly SyncJobName[]): Promise<{ id: string; job: SyncJobName } | null> {
  if (jobs.length === 0) return null;
  const rows = await prisma.$queryRaw<Array<{ id: string; job: string }>>`
    UPDATE "SyncRunRequest"
    SET "status" = 'RUNNING', "startedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "SyncRunRequest"
      WHERE "status" = 'PENDING' AND "job" = ANY(${jobs as unknown as string[]})
      ORDER BY "requestedAt"
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "job"`;
  const row = rows[0];
  return row && isSyncJobName(row.job) ? { id: row.id, job: row.job } : null;
}

export async function finishSyncRequest(id: string, ok: boolean, summary: string): Promise<void> {
  await prisma.syncRunRequest.update({
    where: { id },
    data: { status: ok ? "COMPLETED" : "FAILED", completedAt: new Date(), resultSummary: summary.slice(0, 500) },
  });
}

/** On worker start: a request left RUNNING by the previous process will never finish. */
export async function failOrphanedSyncRequests(jobs: readonly SyncJobName[]): Promise<number> {
  const result = await prisma.syncRunRequest.updateMany({
    where: { job: { in: [...jobs] }, status: "RUNNING" },
    data: { status: "FAILED", completedAt: new Date(), resultSummary: "The worker restarted while this run was in progress. Try again." },
  });
  return result.count;
}

export async function recordSyncJobRun(job: SyncJobName, run: { startedAt: Date; finishedAt: Date; ok: boolean; error?: string }): Promise<void> {
  const durationMs = run.finishedAt.getTime() - run.startedAt.getTime();
  const common = { lastStartedAt: run.startedAt, lastFinishedAt: run.finishedAt, lastOk: run.ok, lastError: run.ok ? null : (run.error ?? "Failed").slice(0, 500), lastDurationMs: durationMs };
  await prisma.syncJobStatus.upsert({
    where: { job },
    create: { job, ...common, lastSuccessAt: run.ok ? run.finishedAt : null },
    update: run.ok ? { ...common, lastSuccessAt: run.finishedAt } : common,
  });
}
