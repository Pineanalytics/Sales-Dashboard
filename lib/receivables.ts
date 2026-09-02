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
  customers: { code: string; name: string; active: boolean; term: string; termDays: number; creditLimit: number; outstanding: number; utilisationPct: number | null; buckets: Record<AgeingBucket, number> }[];
  largestItems: { customer: string; customerCode: string; documentRef: string | null; dueDate: string; openBalance: number; bucket: AgeingBucket }[];
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
    return {
      code: customer.customerCode,
      name: customer.customerName,
      active: customer.active,
      term: customer.creditTerm?.name ?? "(Not assigned)",
      termDays: days,
      creditLimit: customer.creditLimit,
      outstanding: total,
      utilisationPct: customer.creditLimit > 0 ? total / customer.creditLimit * 100 : null,
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
    customers: customerRows.slice(0, 250),
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
