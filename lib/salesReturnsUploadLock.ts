import { Prisma } from "@prisma/client";

/**
 * Serializes delete-and-replace uploads for the same Sales & Returns report
 * and distributor. This is a transaction-scoped PostgreSQL advisory lock, so
 * it is released automatically on success, error, or connection loss.
 */
export async function lockSalesReturnsUpload(
  tx: Prisma.TransactionClient,
  report: string,
  distributors: string[]
): Promise<void> {
  for (const distributor of [...new Set(distributors)].sort()) {
    await tx.$queryRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtext('pinefrost-sales-returns-upload'),
        hashtext(${`${report}:${distributor}`})
      ) IS NULL AS "lockAcquired"
    `);
  }
}
