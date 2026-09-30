// Read-only SAP payables bridge. It mirrors the open vendor ledger into the
// dashboard for Net Working Capital; it never writes SAP.
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "../sql";
import { fetchPayables } from "./query";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

async function main() {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY — configure the same value as the dashboard API.");

  const sourceDate = new Date();
  const data = await withConnection(loadConfigFromEnv(), fetchPayables);
  const vendorCodes = new Set(data.openItems.map((row) => row.vendorCode));
  const ledgerBalance = data.openItems.reduce((sum, row) => sum + row.openBalance, 0);
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  console.log(`[payables-sync] Read ${data.openItems.length} open items across ${vendorCodes.size} vendors from SAP.`);
  const response = await fetch(`${appUrl}/api/payables/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({
      sourceDate: sourceDate.toISOString(),
      openItems: data.openItems.map((row) => ({ ...row, postingDate: row.postingDate.toISOString(), dueDate: row.dueDate.toISOString() })),
      ledgerBalance,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Payables upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  console.log(`[payables-sync] Upload succeeded: ${body.vendorCount} vendors, ${body.openItemCount} open items.`);
}

main().catch((error) => {
  console.error("[payables-sync] FAILED:", error);
  process.exitCode = 1;
});
