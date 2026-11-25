import { prisma } from "./db";
import { isSyncJobName, SAP_SYNC_JOBS, SYNC_JOB_NAMES, type SyncJobName } from "./syncJobs";

// The on/off switch for the sync workers' SCHEDULED runs (Admin > Data & sync). A job with no SyncJobSchedule row is on. Only
// the schedule is affected: "Refresh now" still queues a run, and nothing here talks to SAP or Pine.

export interface SyncScheduleState {
  enabled: boolean;
  changedBy: string | null;
  updatedAt: Date | null;
}

export type ScheduleOutcome = { ok: true; jobs: SyncJobName[]; enabled: boolean } | { ok: false; error: string; status: 400 };

/** Which jobs a request names: an explicit list, or the whole SAP group. */
export function resolveScheduleJobs(input: { jobs?: unknown; group?: unknown }): { ok: true; jobs: SyncJobName[] } | { ok: false; error: string } {
  if (input.group !== undefined) {
    if (input.group !== "sap") return { ok: false, error: '"group" must be "sap".' };
    return { ok: true, jobs: [...SAP_SYNC_JOBS] };
  }
  if (!Array.isArray(input.jobs) || input.jobs.length === 0) return { ok: false, error: `Name at least one job in "jobs", or use "group":"sap".` };
  const bad = input.jobs.find((job) => !isSyncJobName(job));
  if (bad !== undefined) return { ok: false, error: `"jobs" must be from: ${SYNC_JOB_NAMES.join(", ")}.` };
  return { ok: true, jobs: Array.from(new Set(input.jobs as SyncJobName[])) };
}

/** Switch the scheduled runs of some jobs on or off. */
export async function setScheduledRuns(input: { jobs?: unknown; group?: unknown; enabled?: unknown }, changedBy: string | null): Promise<ScheduleOutcome> {
  if (typeof input.enabled !== "boolean") return { ok: false, error: '"enabled" must be true or false.', status: 400 };
  const target = resolveScheduleJobs(input);
  if (!target.ok) return { ok: false, error: target.error, status: 400 };
  await prisma.$transaction(
    target.jobs.map((job) =>
      prisma.syncJobSchedule.upsert({
        where: { job },
        create: { job, enabled: input.enabled as boolean, changedBy },
        update: { enabled: input.enabled as boolean, changedBy },
      })
    )
  );
  return { ok: true, jobs: target.jobs, enabled: input.enabled };
}

/** Every job that has been switched, for the page and the API. A job that is not in the map is on. */
export async function getScheduleStates(): Promise<Map<string, SyncScheduleState>> {
  const rows = await prisma.syncJobSchedule.findMany();
  return new Map(rows.map((row) => [row.job, { enabled: row.enabled, changedBy: row.changedBy, updatedAt: row.updatedAt }] as const));
}

/** Worker side: the jobs, among those it supervises, whose scheduled runs are switched off. */
export async function getDisabledJobs(jobs: readonly SyncJobName[]): Promise<Set<SyncJobName>> {
  const rows = await prisma.syncJobSchedule.findMany({ where: { enabled: false, job: { in: [...jobs] } }, select: { job: true } });
  return new Set(rows.map((row) => row.job).filter(isSyncJobName));
}

/** Worker side: the job to run now, if any. A switched-off job is never returned; when its slot comes round it is moved on to its next
 *  slot instead, exactly as if it had run, so switching it back on resumes at the next regular slot rather than firing a backlog (a daily
 *  year-long SAP read must not start at midday because it was off at 03:30). */
export function pickDueJob<J extends { name: SyncJobName }>(
  jobs: readonly J[],
  nextDue: Map<SyncJobName, number>,
  now: number,
  disabled: ReadonlySet<SyncJobName>,
  reschedule: (job: J) => number
): { due: J | undefined; skipped: J[] } {
  const skipped: J[] = [];
  let due: J | undefined;
  for (const job of jobs) {
    if (now < (nextDue.get(job.name) ?? 0)) continue;
    if (disabled.has(job.name)) {
      nextDue.set(job.name, reschedule(job));
      skipped.push(job);
    } else if (!due) {
      due = job;
    }
  }
  return { due, skipped };
}
