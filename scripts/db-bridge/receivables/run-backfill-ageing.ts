// Standalone CLI entry for the historical ageing backfill — safe to re-run
// anytime (`npm run receivables:backfill-ageing`); skips dates that already
// have a real snapshot. The daily receivables:sync (run.ts) also calls
// backfillMissingAgeingSnapshots() directly after its normal upload, so this
// is mainly for an on-demand catch-up (e.g. right after this feature shipped).
process.loadEnvFile();

import { backfillMissingAgeingSnapshots } from "./backfill-ageing";

backfillMissingAgeingSnapshots().catch((error) => {
  console.error("[ageing-backfill] FAILED:", error);
  process.exitCode = 1;
});
