"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Admin-only — called directly from the Global Ageing tab's client component
// (not via a <form>, since the tab fetches its own report data over GET and
// just re-fetches after this resolves to pick up the new figure). See
// lib/globalAgeing.ts's ReceivablesPdqCheque schema comment for why this
// lives in its own table rather than on CustomerCreditProfile.
export async function updatePdqChequeAction(customerCode: string, amount: number): Promise<{ ok: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") return { ok: false, error: "Not authorized." };

  const trimmedCode = customerCode.trim();
  if (!trimmedCode) return { ok: false, error: "Missing customer code." };
  if (!Number.isFinite(amount)) return { ok: false, error: "Enter a valid number." };

  await prisma.receivablesPdqCheque.upsert({
    where: { customerCode: trimmedCode },
    create: { customerCode: trimmedCode, amount, updatedByEmail: session.user.email ?? null },
    update: { amount, updatedByEmail: session.user.email ?? null },
  });

  return { ok: true };
}
