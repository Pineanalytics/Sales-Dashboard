import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type AgeingBucket = "Current" | "1–30 days" | "31–60 days" | "61–90 days" | "Over 90 days";

const BUCKETS: AgeingBucket[] = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"];

export function ageBucket(dueDate: Date, asOf: Date): AgeingBucket {
  const due = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  const current = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const daysPastDue = Math.floor((current - due) / 86_400_000);
  if (daysPastDue <= 0) return "Current";
  if (daysPastDue <= 30) return "1–30 days";
  if (daysPastDue <= 60) return "31–60 days";
  if (daysPastDue <= 90) return "61–90 days";
  return "Over 90 days";
}

export interface ReceivablesDashboard {
  asOf: string;
  customerCount: number;
  openItemCount: number;
  masterBalance: number;
  ledgerBalance: number;
  variance: number;
  creditLimitBreaches: number;
  buckets: Record<AgeingBucket, number>;
  terms: { groupNum: number | null; name: string; days: number; customers: number; creditLimit: number; outstanding: number }[];
  customers: { code: string; name: string; active: boolean; status: "Within limit" | "Watch" | "Over limit" | "No limit" | "Inactive"; term: string; termDays: number; creditLimit: number; outstanding: number; utilisationPct: number | null; buckets: Record<AgeingBucket, number> }[];
  largestItems: { customer: string; customerCode: string; documentRef: string | null; dueDate: string; openBalance: number; bucket: AgeingBucket }[];
}

/** The totals-only part of the receivables dashboard: what the Executive Summary and the Finance
 *  Presentation actually show. */
export type ReceivablesSummary = Pick<ReceivablesDashboard, "asOf" | "customerCount" | "openItemCount" | "masterBalance" | "ledgerBalance" | "variance" | "creditLimitBreaches" | "buckets">;

/** The same totals as getReceivablesDashboard(), worked out in the database. The full dashboard reads
 *  every customer and every open item and ships both lists to the browser (about 2 MB); the two screens
 *  that only need these totals use this instead. The ageing rule is ageBucket()'s: days past due as of
 *  the sync's source date, and a customer breaches its limit when what it owes is over its (positive)
 *  credit limit. */
export async function getReceivablesSummary(): Promise<ReceivablesSummary | null> {
  const latest = await prisma.receivablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latest) return null;

  const asOfDate = latest.sourceDate.toISOString().slice(0, 10);
  const [bucketRows, breachRows] = await Promise.all([
    prisma.$queryRaw<{ bucket: string; total: number }[]>(Prisma.sql`
      SELECT CASE
               WHEN (${asOfDate}::date - "dueDate") <= 0 THEN ${BUCKETS[0]}::text
               WHEN (${asOfDate}::date - "dueDate") <= 30 THEN ${BUCKETS[1]}::text
               WHEN (${asOfDate}::date - "dueDate") <= 60 THEN ${BUCKETS[2]}::text
               WHEN (${asOfDate}::date - "dueDate") <= 90 THEN ${BUCKETS[3]}::text
               ELSE ${BUCKETS[4]}::text
             END AS bucket,
             COALESCE(SUM("openBalance"), 0)::float8 AS total
      FROM "ReceivableOpenItem"
      GROUP BY 1`),
    prisma.$queryRaw<{ breaches: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS breaches
      FROM "CustomerCreditProfile" c
      LEFT JOIN (SELECT "customerCode", SUM("openBalance") AS total FROM "ReceivableOpenItem" GROUP BY "customerCode") o
        ON o."customerCode" = c."customerCode"
      WHERE c."creditLimit" > 0 AND COALESCE(o.total, 0) > c."creditLimit"`),
  ]);

  const buckets = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<AgeingBucket, number>;
  for (const row of bucketRows) if (row.bucket in buckets) buckets[row.bucket as AgeingBucket] = Number(row.total);

  return {
    asOf: latest.sourceDate.toISOString(),
    customerCount: latest.customerCount,
    openItemCount: latest.openItemCount,
    masterBalance: latest.masterBalance,
    ledgerBalance: latest.ledgerBalance,
    variance: latest.variance,
    creditLimitBreaches: Number(breachRows[0]?.breaches ?? 0),
    buckets,
  };
}

export async function getReceivablesDashboard(): Promise<ReceivablesDashboard | null> {
  const latest = await prisma.receivablesSyncRun.findFirst({ orderBy: { completedAt: "desc" } });
  if (!latest) return null;

  const [customers, openItems] = await Promise.all([
    prisma.customerCreditProfile.findMany({ include: { creditTerm: true }, orderBy: { masterBalance: "desc" } }),
    prisma.receivableOpenItem.findMany({ select: { customerCode: true, documentRef: true, dueDate: true, openBalance: true }, orderBy: { openBalance: "desc" } }),
  ]);
  const buckets = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<AgeingBucket, number>;
  const byCustomer = new Map<string, Record<AgeingBucket, number>>();
  const customerNames = new Map(customers.map((row) => [row.customerCode, row.customerName]));
  for (const item of openItems) {
    const bucket = ageBucket(item.dueDate, latest.sourceDate);
    buckets[bucket] += item.openBalance;
    const row = byCustomer.get(item.customerCode) ?? Object.fromEntries(BUCKETS.map((key) => [key, 0])) as Record<AgeingBucket, number>;
    row[bucket] += item.openBalance;
    byCustomer.set(item.customerCode, row);
  }
  const customerRows = customers.map((customer) => {
    const customerBuckets = byCustomer.get(customer.customerCode) ?? Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<AgeingBucket, number>;
    const total = BUCKETS.reduce((sum, bucket) => sum + customerBuckets[bucket], 0);
    const days = (customer.creditTerm?.extraDays ?? 0) + (customer.creditTerm?.extraMonths ?? 0) * 30;
    const utilisationPct = customer.creditLimit > 0 ? total / customer.creditLimit * 100 : null;
    const status: ReceivablesDashboard["customers"][number]["status"] = !customer.active
      ? "Inactive"
      : utilisationPct === null
        ? "No limit"
        : utilisationPct > 100
          ? "Over limit"
          : utilisationPct >= 80
            ? "Watch"
            : "Within limit";
    return {
      code: customer.customerCode,
      name: customer.customerName,
      active: customer.active,
      status,
      term: customer.creditTerm?.name ?? "(Not assigned)",
      termDays: days,
      creditLimit: customer.creditLimit,
      outstanding: total,
      utilisationPct,
      buckets: customerBuckets,
    };
  }).sort((a, b) => b.outstanding - a.outstanding);

  const terms = new Map<string, { groupNum: number | null; name: string; days: number; customers: number; creditLimit: number; outstanding: number }>();
  for (const row of customerRows) {
    const key = `${row.term}|${row.termDays}`;
    const aggregate = terms.get(key) ?? { groupNum: null, name: row.term, days: row.termDays, customers: 0, creditLimit: 0, outstanding: 0 };
    aggregate.customers += 1;
    aggregate.creditLimit += row.creditLimit;
    aggregate.outstanding += row.outstanding;
    terms.set(key, aggregate);
  }

  return {
    asOf: latest.sourceDate.toISOString(),
    customerCount: latest.customerCount,
    openItemCount: latest.openItemCount,
    masterBalance: latest.masterBalance,
    ledgerBalance: latest.ledgerBalance,
    variance: latest.variance,
    creditLimitBreaches: customerRows.filter((row) => row.utilisationPct !== null && row.utilisationPct > 100).length,
    buckets,
    terms: [...terms.values()].sort((a, b) => b.outstanding - a.outstanding),
    customers: customerRows,
    largestItems: openItems.slice(0, 50).map((item) => ({
      customer: customerNames.get(item.customerCode) ?? item.customerCode,
      customerCode: item.customerCode,
      documentRef: item.documentRef,
      dueDate: item.dueDate.toISOString(),
      openBalance: item.openBalance,
      bucket: ageBucket(item.dueDate, latest.sourceDate),
    })),
  };
}
