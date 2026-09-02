// Read-only SAP receivables bridge. It mirrors customer credit master data,
// payment terms and open ledger items into the dashboard; it never writes SAP.
process.loadEnvFile();

import { loadConfigFromEnv, withConnection } from "../sql";
import { fetchReceivables } from "./query";

const DEFAULT_APP_URL = "https://pinefrostdb.com";

async function main() {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) throw new Error("Missing UPLOAD_API_KEY — configure the same value as the dashboard API.");

  const sourceDate = new Date();
  const data = await withConnection(loadConfigFromEnv(), fetchReceivables);
  const masterBalance = data.customers.reduce((sum, row) => sum + row.masterBalance, 0);
  const ledgerBalance = data.openItems.reduce((sum, row) => sum + row.openBalance, 0);
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  console.log(`[receivables-sync] Read ${data.customers.length} customers, ${data.terms.length} terms and ${data.openItems.length} open items from SAP.`);
  const response = await fetch(`${appUrl}/api/receivables/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-upload-api-key": apiKey },
    body: JSON.stringify({
      sourceDate: sourceDate.toISOString(),
      terms: data.terms,
      customers: data.customers,
      openItems: data.openItems.map((row) => ({ ...row, postingDate: row.postingDate.toISOString(), dueDate: row.dueDate.toISOString() })),
      masterBalance,
      ledgerBalance,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Receivables upload rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  console.log(`[receivables-sync] Upload succeeded: ${body.customerCount} customers, ${body.openItemCount} open items, variance ${body.variance}.`);
}

main().catch((error) => {
  console.error("[receivables-sync] FAILED:", error);
  process.exitCode = 1;
});
