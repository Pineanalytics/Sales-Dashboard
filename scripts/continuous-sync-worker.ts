// Continuous bridge supervisor. It is deliberately a separate process from
// Next.js: slow source reads never run on a dashboard request path. Each
// container receives a small job set and runs at most one source read at once.
// If a source is temporarily unavailable, the next interval retries it while
// the dashboard continues serving the last verified local snapshot.
import { spawn } from "node:child_process";
import { claimSyncRequest, failOrphanedSyncRequests, finishSyncRequest, recordSyncJobRun } from "../lib/syncRunRequests";
import type { SyncJobName } from "../lib/syncJobs";

type JobName = SyncJobName;

// How often a worker looks for a "Refresh now" request from Admin > Data & sync. One indexed query.
const MANUAL_POLL_MS = 10_000;
// If the queue table is missing (a deploy before the schema push) or the database is briefly
// unreachable, back off instead of logging every ten seconds.
const MANUAL_POLL_BACKOFF_MS = 120_000;

interface JobDefinition {
  name: JobName;
  entry: string;
  intervalEnv: string;
  defaultSeconds: number;
  dailyAtEnv?: string;
  runOnStartEnv?: string;
  /** Extra command-line arguments for the job script. */
  args?: string[];
  /** NODE_OPTIONS for this job only, so one memory-hungry read does not raise the limit for every job in the container. */
  nodeOptions?: string;
}

const jobs: Record<JobName, JobDefinition> = {
  timestamps: { name: "timestamps", entry: "scripts/db-bridge/timestamps/run.ts", intervalEnv: "TIMESTAMPS_INTERVAL_SECONDS", defaultSeconds: 30 },
  // Current-month Pine coverage uses the same business rules as the workbook's
  // Calls & Productivity query, but is persisted directly to Postgres.
  coverage: { name: "coverage", entry: "scripts/db-bridge/coverage/sync.ts", intervalEnv: "COVERAGE_INTERVAL_SECONDS", defaultSeconds: 1800 },
  eabl: { name: "eabl", entry: "scripts/db-bridge/eabl-call-performance/run.ts", intervalEnv: "EABL_INTERVAL_SECONDS", defaultSeconds: 60 },
  // Reference/master data, not a live call feed - the source table barely
  // changes day to day (confirmed live: ~800-1000 rows total), so this runs
  // far less often than the 60s call sync above. Default 6 hours.
  "eabl-customers": { name: "eabl-customers", entry: "scripts/db-bridge/eabl-call-performance/sync-customers.ts", intervalEnv: "EABL_CUSTOMERS_INTERVAL_SECONDS", defaultSeconds: 21_600 },
  "active-outlets": { name: "active-outlets", entry: "scripts/db-bridge/active-outlets/run.ts", intervalEnv: "ACTIVE_OUTLETS_INTERVAL_SECONDS", defaultSeconds: 86_400, dailyAtEnv: "ACTIVE_OUTLETS_DAILY_AT", runOnStartEnv: "ACTIVE_OUTLETS_RUN_ON_START" },
  // Reads the same Pine source as Active Outlets/Timestamps but a different,
  // heavier ledger (SAP_Orders backfills 3 months on its first run), so it
  // gets its own isolated worker rather than sharing one of theirs.
  "order-360": { name: "order-360", entry: "scripts/db-bridge/order-360/run.ts", intervalEnv: "ORDER_360_INTERVAL_SECONDS", defaultSeconds: 86_400, dailyAtEnv: "ORDER_360_DAILY_AT", runOnStartEnv: "ORDER_360_RUN_ON_START" },
  // Mars reads a large principal-specific Pine ledger, so it stays isolated
  // from time-sensitive call feeds.  It performs a full safety refresh daily
  // and small current-period updates between those passes.
  "mars-kpis": { name: "mars-kpis", entry: "scripts/db-bridge/principal-kpis/mars-sync.ts", intervalEnv: "MARS_KPIS_INTERVAL_SECONDS", defaultSeconds: 900, runOnStartEnv: "MARS_KPIS_RUN_ON_START" },
  sales: { name: "sales", entry: "scripts/db-bridge/sales-sync.ts", intervalEnv: "SALES_INTERVAL_SECONDS", defaultSeconds: 1800 },
  // SFA-outlet sales (SalesDocument + SfaCustomerActual), which the Customer analysis ranks. Every 30 minutes, two months each run, so the
  // previous month keeps absorbing late SAP postings and a month rollover needs no special case.
  "sfa-sales": { name: "sfa-sales", entry: "scripts/db-bridge/sfa-sales-sync.ts", intervalEnv: "SFA_SALES_INTERVAL_SECONDS", defaultSeconds: 1800, runOnStartEnv: "SFA_SALES_RUN_ON_START", args: ["--months=2"], nodeOptions: "--max-old-space-size=700" },
  // Stock receipts (goods receipts, returns and credits) from SAP's stock ledger, for the Purchases report: the current and previous month every 30 minutes. Like every job without
  // a runOnStartEnv it also runs once when the worker starts (a two-month read, about 20 seconds); a history load is a separate, approved manual run.
  purchases: { name: "purchases", entry: "scripts/db-bridge/purchases-sync.ts", intervalEnv: "PURCHASES_INTERVAL_SECONDS", defaultSeconds: 1800, args: ["--months=2"] },
  // Performance Analysis reads the whole year of SAP document lines (~575k), so it
  // runs once a day in the small hours rather than on the 5-minute sales cadence,
  // and it never runs on start (a deploy must not trigger a year-long SAP read).
  performance: { name: "performance", entry: "scripts/db-bridge/performance-analysis/run.ts", intervalEnv: "PERFORMANCE_INTERVAL_SECONDS", defaultSeconds: 86_400, dailyAtEnv: "PERFORMANCE_DAILY_AT", runOnStartEnv: "PERFORMANCE_RUN_ON_START" },
  pl: { name: "pl", entry: "scripts/pl-bridge/run.ts", intervalEnv: "PL_INTERVAL_SECONDS", defaultSeconds: 1800 },
  stock: { name: "stock", entry: "scripts/db-bridge/stock-sync.ts", intervalEnv: "STOCK_INTERVAL_SECONDS", defaultSeconds: 1800 },
  receivables: { name: "receivables", entry: "scripts/db-bridge/receivables/run.ts", intervalEnv: "RECEIVABLES_INTERVAL_SECONDS", defaultSeconds: 1800 },
  // The rep directory (docs/rep-directory-scope.md): SAP's salesperson master and Pine's user list each read in full (a few hundred and
  // under a thousand rows), and a Postgres-only pass that derives the reps of Leverage, DataEdge and EABL DMS from stored sales rows.
  "sap-reps": { name: "sap-reps", entry: "scripts/db-bridge/rep-directory/sap-reps.ts", intervalEnv: "SAP_REPS_INTERVAL_SECONDS", defaultSeconds: 1800 },
  "pine-reps": { name: "pine-reps", entry: "scripts/db-bridge/rep-directory/pine-reps.ts", intervalEnv: "PINE_REPS_INTERVAL_SECONDS", defaultSeconds: 1800 },
  "rep-directory": { name: "rep-directory", entry: "scripts/db-bridge/rep-directory/derive.ts", intervalEnv: "REP_DIRECTORY_INTERVAL_SECONDS", defaultSeconds: 1800 },
};

function intervalMs(job: JobDefinition): number {
  const configured = Number(process.env[job.intervalEnv] ?? job.defaultSeconds);
  if (!Number.isFinite(configured) || configured < 10) throw new Error(`${job.intervalEnv} must be at least 10 seconds.`);
  return configured * 1000;
}

function nextRunAt(job: JobDefinition, now = new Date()): number {
  if (!job.dailyAtEnv || !process.env[job.dailyAtEnv]) return Date.now() + intervalMs(job);
  const match = process.env[job.dailyAtEnv]!.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new Error(`${job.dailyAtEnv} must be HH:MM.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`${job.dailyAtEnv} must be a valid 24-hour time.`);
  const scheduled = new Date(now);
  scheduled.setHours(hour, minute, 0, 0);
  if (scheduled <= now) scheduled.setDate(scheduled.getDate() + 1);
  return scheduled.getTime();
}

function runsOnStart(job: JobDefinition): boolean {
  return job.runOnStartEnv ? process.env[job.runOnStartEnv] === "true" : true;
}

/** Prisma errors span many lines of query echo; the last non-empty line is the cause. */
function brief(error: unknown): string {
  const lines = (error instanceof Error ? error.message : String(error)).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "unknown error";
}

/** Runs a job and records the outcome (scheduled or manual) so Data & sync can show it. Recording is
 *  best-effort: a database hiccup must never stop the sync loop. */
async function runTracked(job: JobDefinition): Promise<{ summary: string }> {
  const startedAt = new Date();
  let error: unknown = null;
  try {
    await run(job);
  } catch (caught) {
    error = caught;
  }
  const finishedAt = new Date();
  const ok = error === null;
  const message = error instanceof Error ? error.message : error === null ? "" : String(error);
  await recordSyncJobRun(job.name, { startedAt, finishedAt, ok, error: message }).catch((recordError) =>
    console.error(`[worker] could not record the ${job.name} run: ${brief(recordError)}`)
  );
  if (!ok) throw error;
  return { summary: `Completed in ${Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000)}s.` };
}

function run(job: JobDefinition): Promise<void> {
  const startedAt = new Date();
  console.log(`[worker] ${job.name} started at ${startedAt.toISOString()}.`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", job.entry, ...(job.args ?? [])], {
      stdio: "inherit",
      env: job.nodeOptions ? { ...process.env, NODE_OPTIONS: job.nodeOptions } : process.env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`[worker] ${job.name} completed in ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s.`);
        resolve();
      } else {
        reject(new Error(`${job.name} exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
      }
    });
  });
}

async function main() {
  const requested = (process.env.CONTINUOUS_SYNC_JOBS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (requested.length === 0) throw new Error("CONTINUOUS_SYNC_JOBS must name at least one job.");
  const selected = requested.map((name) => {
    if (!(name in jobs)) throw new Error(`Unknown continuous sync job: ${name}.`);
    return jobs[name as JobName];
  });
  const nextDue = new Map<JobName, number>(selected.map((job) => [job.name, runsOnStart(job) ? 0 : nextRunAt(job)]));
  console.log(`[worker] supervising ${selected.map((job) => `${job.name}/${job.dailyAtEnv && process.env[job.dailyAtEnv] ? `daily ${process.env[job.dailyAtEnv]}` : `${intervalMs(job) / 1000}s`}`).join(", ")}.`);

  const orphaned = await failOrphanedSyncRequests(selected.map((job) => job.name)).catch(() => 0);
  if (orphaned > 0) console.log(`[worker] marked ${orphaned} manual run(s) left over from the previous process as failed.`);
  let nextManualPoll = 0;
  let manualFailures = 0;

  // A single source read per worker makes its CPU/DB impact predictable. The
  // live timestamps worker is isolated from Active Outlets and SAP, so its
  // 30-second lane cannot be held behind a full-year aggregation.
  for (;;) {
    const now = Date.now();

    // A "Refresh now" from Admin > Data & sync goes first, between two scheduled runs (never during one,
    // so the one-source-read-at-a-time rule above still holds). The job's own schedule restarts from now.
    if (now >= nextManualPoll) {
      let claimed: Awaited<ReturnType<typeof claimSyncRequest>> = null;
      try {
        claimed = await claimSyncRequest(selected.map((job) => job.name));
        manualFailures = 0;
        nextManualPoll = Date.now() + MANUAL_POLL_MS;
      } catch (error) {
        manualFailures += 1;
        if (manualFailures === 1) console.error(`[worker] cannot check for manual refresh requests; will keep retrying quietly: ${brief(error)}`);
        nextManualPoll = Date.now() + MANUAL_POLL_BACKOFF_MS;
      }
      if (claimed) {
        const job = jobs[claimed.job];
        console.log(`[worker] manual refresh of ${job.name} requested from Data & sync.`);
        nextDue.set(job.name, nextRunAt(job));
        try {
          const result = await runTracked(job);
          await finishSyncRequest(claimed.id, true, result.summary).catch(() => undefined);
        } catch (error) {
          console.error(`[worker] manual ${job.name} run failed; retaining the prior dashboard snapshot.`, error);
          await finishSyncRequest(claimed.id, false, error instanceof Error ? error.message : String(error)).catch(() => undefined);
        }
        continue;
      }
    }

    const due = selected.find((job) => now >= (nextDue.get(job.name) ?? 0));
    if (!due) {
      const soonest = Math.min(nextManualPoll, ...selected.map((job) => nextDue.get(job.name) ?? now + 1000));
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, Math.min(soonest - now, 1000))));
      continue;
    }
    nextDue.set(due.name, nextRunAt(due));
    try {
      await runTracked(due);
    } catch (error) {
      console.error(`[worker] ${due.name} failed; retaining the prior dashboard snapshot and retrying next interval.`, error);
    }
  }
}

main().catch((error) => {
  console.error("[worker] fatal supervisor error:", error);
  process.exitCode = 1;
});
