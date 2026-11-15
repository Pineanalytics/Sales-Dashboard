// Feed keys: how an outside workbook (Power Query on SharePoint) reads a data feed without a dashboard login. A key is random, shown once, and stored
// only as its SHA-256 hash (DataFeedKey). Server only.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

const KEY_PREFIX = "pfk_";

export function generateFeedKey(): string {
  return `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
}

export function hashFeedKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** The key's visible start, to tell keys apart in a list without revealing them. */
export function feedKeyPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 6);
}

/** Lookup by hash, then a constant-time compare of the hashes. A revoked key, or one for another feed, is refused. */
export async function verifyFeedKey(feed: string, key: string | null): Promise<{ id: string; name: string } | null> {
  if (!key || !key.startsWith(KEY_PREFIX) || key.length > 200) return null;
  const hash = hashFeedKey(key);
  const row = await prisma.dataFeedKey.findUnique({ where: { keyHash: hash } });
  if (!row || row.revokedAt || row.feed !== feed) return null;
  if (!timingSafeEqual(Buffer.from(row.keyHash, "hex"), Buffer.from(hash, "hex"))) return null;
  // Record use at most every five minutes, so a busy refresh schedule does not write on every request.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
    await prisma.dataFeedKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { id: row.id, name: row.name };
}

/** The address workbooks connect to. */
export function feedBaseUrl(): string {
  return (process.env.APP_URL || "https://pinefrostdb.com").replace(/\/$/, "");
}
