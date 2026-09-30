// Reconstructs TRUE historical AR ageing snapshots from SAP's own
// payment-reconciliation history (see historicalAgeing.ts's doc comment for
// the two correctness pitfalls found and fixed) — replacing the old
// approximation (re-aging today's still-open items, scripts/backfill-
// receivables-ageing-snapshot.ts, retired) with a real, isApproximate: false
// snapshot for every date. Safe and cheap to re-run: skips any date that
// already has a real snapshot rather than re-querying SAP for it. Exports
// only — see run-backfill-ageing.ts for the standalone CLI entry point;
// run.ts (the daily receivables:sync) imports backfillMissingAgeingSnapshots
// directly.
import { loadConfigFromEnv, withConnection } from "../sql";
import { fetchHistoricalAgeingOpenItems } from "./historicalAgeing";
import { getWeeksInMonth } from "../../../lib/weeklyTargets";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

/** Every already-elapsed calendar week-end (Sunday-start + 6) and each
 *  month's own last calendar day, from January 1st of the current year
 *  through today — matches every date getAgeingSnapshotForMonth's
 *  nearest-at-or-before lookup could actually need, for whichever month a
 *  viewer selects in the Ageing Trend tab, not just the current one. */
function targetDates(now: Date): Date[] {
  const dates = new Map<number, Date>();
  const add = (d: Date) => {
    const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    if (day.getTime() <= now.getTime()) dates.set(day.getTime(), day);
  };
  for (let m = 0; m <= now.getUTCMonth(); m += 1) {
    for (const week of getWeeksInMonth(now.getUTCFullYear(), m)) {
      add(new Date(week.weekStartDate.getTime() + 6 * 86_400_000));
    }
    add(new Date(Date.UTC(now.getUTCFullYear(), m + 1, 0))); // that month's last day
  }
  add(new Date(Date.UTC(now.getUTCFullYear(), 0, 0))); // prior Dec 31, for January's "last month" row
  return Array.from(dates.values()).sort((a, b) => a.getTime() - b.getTime());
}

/** Backfills every past week-end/month-end date (from January 1st of the
 *  current year through today) that doesn't yet have a real snapshot —
 *  called both by this file's own standalone CLI run and by the regular
 *  daily receivables:sync (run.ts), so the "Approximate" state can never
 *  recur: each elapsed week/month boundary gets a real snapshot the moment
 *  the sync first runs on-or-after that date. Cheap to call on every sync —
 *  once caught up, the status check finds nothing missing and skips the SAP
 *  query entirely. */
export async function backfillMissingAgeingSnapshots(): Promise<void> {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY — configure the same value as the dashboard API.");
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;
  const headers = { "Content-Type": "application/json", "x-upload-api-key": apiKey };

  const statusRes = await fetch(`${appUrl}/api/receivables/ageing-snapshot`, { headers });
  if (!statusRes.ok) throw new Error(`Failed to list existing snapshots (HTTP ${statusRes.status}): ${await statusRes.text()}`);
  const { snapshots } = (await statusRes.json()) as { snapshots: { snapshotDate: string; isApproximate: boolean }[] };
  const realDates = new Set(snapshots.filter((s) => !s.isApproximate).map((s) => s.snapshotDate.slice(0, 10)));

  const now = new Date();
  const targets = targetDates(now).filter((d) => !realDates.has(d.toISOString().slice(0, 10)));
  if (targets.length === 0) {
    console.log("[ageing-backfill] Every target date already has a real snapshot — nothing to do.");
    return;
  }
  console.log(`[ageing-backfill] ${targets.length} date(s) need a real snapshot: ${targets.map((d) => d.toISOString().slice(0, 10)).join(", ")}`);

  await withConnection(loadConfigFromEnv(), async (pool) => {
    for (const asOf of targets) {
      const items = await fetchHistoricalAgeingOpenItems(pool, asOf);
      const total = items.reduce((sum, i) => sum + i.openBalance, 0);
      const res = await fetch(`${appUrl}/api/receivables/ageing-snapshot`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          snapshotDate: asOf.toISOString(),
          items: items.map((i) => ({ dueDate: i.dueDate.toISOString(), openBalance: i.openBalance })),
        }),
      });
      if (!res.ok) throw new Error(`Upload rejected for ${asOf.toISOString().slice(0, 10)} (HTTP ${res.status}): ${await res.text()}`);
      console.log(`[ageing-backfill] ${asOf.toISOString().slice(0, 10)}: ${items.length} open items, total ${total.toFixed(2)} — saved.`);
    }
  });
  console.log(`[ageing-backfill] Done — ${targets.length} real snapshot(s) written.`);
}
