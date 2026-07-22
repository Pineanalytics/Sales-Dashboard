// Entry point for the daily AI Insights digest. Unlike the SAP/Pine bridge
// syncs, this needs no local DB connection — the underlying data is already
// in Postgres, so this is a bare HTTP trigger for /api/ai-insights/generate
// (same UPLOAD_API_KEY header auth as sales-sync.ts/pl-sync.ts). Run with:
// npm run ai-insights:sync
process.loadEnvFile();

const DEFAULT_APP_URL = "https://pinefrostdb.netlify.app";

async function main() {
  const apiKey = process.env.UPLOAD_API_KEY;
  if (!apiKey) {
    throw new Error("Missing UPLOAD_API_KEY — set it in .env (same value configured in Netlify).");
  }
  const appUrl = process.env.PL_BRIDGE_APP_URL || DEFAULT_APP_URL;

  console.log(`[ai-insights] Requesting digest from ${appUrl}/api/ai-insights/generate...`);
  const response = await fetch(`${appUrl}/api/ai-insights/generate`, {
    method: "POST",
    headers: { "x-upload-api-key": apiKey },
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Generation rejected (HTTP ${response.status}): ${JSON.stringify(body)}`);
  }
  console.log(`[ai-insights] Digest generated: ${body.insight.findings.length} finding(s).`);
}

main().catch((err) => {
  console.error("[ai-insights] FAILED:", err);
  process.exitCode = 1;
});
