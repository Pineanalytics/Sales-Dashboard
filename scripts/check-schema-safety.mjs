import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

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
const destructive = [
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
];

if (destructive.some((pattern) => pattern.test(sql))) {
  console.error("Destructive Prisma schema SQL detected. Use an expand/contract change and a reviewed data migration instead:\n");
  console.error(sql);
  process.exit(1);
}

console.log(sql ? "Schema diff is additive/non-destructive." : "No Prisma schema changes detected.");
