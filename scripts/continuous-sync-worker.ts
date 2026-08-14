// Continuous bridge supervisor. It is deliberately a separate process from
// Next.js: slow source reads never run on a dashboard request path. Each
// container receives a small job set and runs at most one source read at once.
// If a source is temporarily unavailable, the next interval retries it while
// the dashboard continues serving the last verified local snapshot.
import { spawn } from "node:child_process";

type JobName = "timestamps" | "eabl" | "active-outlets" | "sales" | "pl" | "stock";

interface JobDefinition {
  name: JobName;
  entry: string;
  intervalEnv: string;
  defaultSeconds: number;
}

const jobs: Record<JobName, JobDefinition> = {
  timestamps: { name: "timestamps", entry: "scripts/db-bridge/timestamps/run.ts", intervalEnv: "TIMESTAMPS_INTERVAL_SECONDS", defaultSeconds: 30 },
  eabl: { name: "eabl", entry: "scripts/db-bridge/eabl-call-performance/run.ts", intervalEnv: "EABL_INTERVAL_SECONDS", defaultSeconds: 60 },
  "active-outlets": { name: "active-outlets", entry: "scripts/db-bridge/active-outlets/run.ts", intervalEnv: "ACTIVE_OUTLETS_INTERVAL_SECONDS", defaultSeconds: 300 },
  sales: { name: "sales", entry: "scripts/db-bridge/sales-sync.ts", intervalEnv: "SALES_INTERVAL_SECONDS", defaultSeconds: 300 },
  pl: { name: "pl", entry: "scripts/pl-bridge/run.ts", intervalEnv: "PL_INTERVAL_SECONDS", defaultSeconds: 1800 },
  stock: { name: "stock", entry: "scripts/db-bridge/stock-sync.ts", intervalEnv: "STOCK_INTERVAL_SECONDS", defaultSeconds: 900 },
};

function intervalMs(job: JobDefinition): number {
  const configured = Number(process.env[job.intervalEnv] ?? job.defaultSeconds);
  if (!Number.isFinite(configured) || configured < 10) throw new Error(`${job.intervalEnv} must be at least 10 seconds.`);
  return configured * 1000;
}

function run(job: JobDefinition): Promise<void> {
  const startedAt = new Date();
  console.log(`[worker] ${job.name} started at ${startedAt.toISOString()}.`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", job.entry], {
      stdio: "inherit",
      env: process.env,
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
  const nextDue = new Map<JobName, number>(selected.map((job) => [job.name, 0]));
  console.log(`[worker] supervising ${selected.map((job) => `${job.name}/${intervalMs(job) / 1000}s`).join(", ")}.`);

  // A single source read per worker makes its CPU/DB impact predictable. The
  // live timestamps worker is isolated from Active Outlets and SAP, so its
  // 30-second lane cannot be held behind a full-year aggregation.
  for (;;) {
    const now = Date.now();
    const due = selected.find((job) => now >= (nextDue.get(job.name) ?? 0));
    if (!due) {
      const soonest = Math.min(...selected.map((job) => nextDue.get(job.name) ?? now + 1000));
      await new Promise((resolve) => setTimeout(resolve, Math.max(250, Math.min(soonest - now, 1000))));
      continue;
    }
    nextDue.set(due.name, Date.now() + intervalMs(due));
    try {
      await run(due);
    } catch (error) {
      console.error(`[worker] ${due.name} failed; retaining the prior dashboard snapshot and retrying next interval.`, error);
    }
  }
}

main().catch((error) => {
  console.error("[worker] fatal supervisor error:", error);
  process.exitCode = 1;
});
