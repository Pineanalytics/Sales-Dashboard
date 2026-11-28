// Rep contribution shares and daily targets are rebuilt for the whole company whenever a roster edit can change them. That is a long job
// (every rep's sales and call history), and running it inside the save made the Employee Roster hang on every save. It now runs after the
// response has gone (Next's after()), and overlapping requests share one run: a request that arrives while a rebuild is running asks for one
// more pass when it finishes, so the last edit is always included without stacking rebuilds.
import { after } from "next/server";
import { recomputeDailyTargets, recomputeRepContribution } from "@/lib/repContribution";

let running: Promise<void> | null = null;
let rerun = false;

async function runCoalesced(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerun = false;
        await recomputeRepContribution();
        await recomputeDailyTargets();
      } while (rerun);
    } catch (error) {
      console.error("Background rep contribution / daily target rebuild failed", error);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Schedules the company-wide contribution and daily-target rebuild for after the current response. */
export function rebuildTargetsAfterResponse(): void {
  after(runCoalesced);
}
