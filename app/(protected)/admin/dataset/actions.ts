"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { dataFeedById, powerQueryScript } from "@/lib/dataFeedScript";
import { feedBaseUrl, feedKeyPrefix, generateFeedKey, hashFeedKey } from "@/lib/dataFeeds";

const PAGE = "/admin/dataset";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") throw new Error("Admins only.");
  return session.user;
}

export type CreateFeedKeyResult = { ok: true; key: string; script: string; feedLabel: string } | { ok: false; error: string };

/** Creates a feed key and returns it once, with the Power Query script that uses it. Only the key's hash is kept. */
export async function createFeedKeyAction(input: { name: string; feed: string; period: string }): Promise<CreateFeedKeyResult> {
  const user = await requireAdmin();
  const name = input.name.trim().slice(0, 80);
  const feed = dataFeedById(input.feed);
  if (!name) return { ok: false, error: "Give the key a name, e.g. “SharePoint Outlet Master”." };
  if (!feed) return { ok: false, error: "Unknown feed." };
  const period = feed.periods.some((option) => option.value === input.period) ? input.period : feed.defaultPeriod;
  const key = generateFeedKey();
  await prisma.dataFeedKey.create({ data: { name, feed: feed.id, keyHash: hashFeedKey(key), keyPrefix: feedKeyPrefix(key), createdBy: user.email ?? "admin" } });
  revalidatePath(PAGE);
  return { ok: true, key, feedLabel: feed.label, script: powerQueryScript({ baseUrl: feedBaseUrl(), feed, key, period }) };
}

/** Stops a key at once: every workbook using it fails its next refresh. */
export async function revokeFeedKeyAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.dataFeedKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  revalidatePath(PAGE);
}
