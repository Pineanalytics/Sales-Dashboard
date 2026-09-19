import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// DROP NOT NULL and DROP DEFAULT relax a constraint - they widen what a
// column accepts and never remove or truncate existing data, unlike
// DROP TABLE/COLUMN/CONSTRAINT/INDEX or TRUNCATE. They're the standard,
// safe "expand" step this project's own governance doc recommends (add
// nullable structures, deploy compatible code, backfill, then contract
// later) - excluded here so that expand step doesn't trip this guard
// alongside genuinely destructive statements. Confirmed live: an
// `ALTER COLUMN "x" DROP NOT NULL` diff was rejected by this check before
// this fix, for a schema change that lost no data.
export function isDestructiveSql(sql) {
  const destructive = [
    /\bDROP\s+(?!NOT\s+NULL\b|DEFAULT\b)/i,
    /\bTRUNCATE\b/i,
  ];
  return destructive.some((pattern) => pattern.test(sql));
}

// Only run the CLI when this file is executed directly (`node
// scripts/check-schema-safety.mjs ...`) - not when imported (tests import
// isDestructiveSql in isolation without wanting the CLI's process.exit calls).
const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const [baseSchema, currentSchema = "prisma/schema.prisma"] = process.argv.slice(2);
  if (!baseSchema || !existsSync(baseSchema) || !existsSync(currentSchema)) {
    console.error("Usage: node scripts/check-schema-safety.mjs <base-schema.prisma> [current-schema.prisma]");
    process.exit(2);
  }

  const prismaCli = resolve("node_modules/prisma/build/index.js");
  if (!existsSync(prismaCli)) {
    console.error("Prisma CLI is not installed. Run npm ci first.");
    process.exit(2);
  }

  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      `--from-schema-datamodel=${baseSchema}`,
      `--to-schema-datamodel=${currentSchema}`,
      "--script",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || result.error?.message || "Prisma schema diff failed.\n");
    process.exit(result.status ?? 1);
  }

  const sql = result.stdout.trim();

  if (isDestructiveSql(sql)) {
    console.error("Destructive Prisma schema SQL detected. Use an expand/contract change and a reviewed data migration instead:\n");
    console.error(sql);
    process.exit(1);
  }

  console.log(sql ? "Schema diff is additive/non-destructive." : "No Prisma schema changes detected.");
}
