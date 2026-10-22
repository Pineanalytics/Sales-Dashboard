// Distinct-customer coverage. CoverageActual counts each rep's own outlets, so adding it up over reps and principals counts a shop that two reps
// call on, or that buys from two principals, once per rep and per principal. CoverageCustomerActual holds one row per month, role, principal and
// customer, so a customer can be counted once at any level. This module rolls those rows up into CoverageDistinctMonthly (one small row per month,
// principal brand and role), which the dataset carries to the browser; timeIntelligence's coverage summarisers read it, and fall back to the rep
// sums for any month or principal that has no customer-level data (EABL DMS, Upfield DataEdge, earlier years).
import { Prisma } from "@prisma/client";
import { normalizePrincipalKey } from "./normalize";
import { classifyRole } from "./timeIntelligence";
import type { CoverageDistinctRow } from "./types";

/** principalKey / roleCategory value that stands for "every principal" / "every role". */
export const ALL = "*";

export interface CustomerCoverageInput {
  principal: string;
  salesRole: string;
  customerId: string;
  /** Reps that had a sale or an order at the customer this month; above zero = a productive customer. */
  productiveCalls: number;
}

/** Counts every customer once per scope: each brand, role and the "all" level of both. */
export function computeCoverageDistinct(year: string, monthIndex: number, rows: CustomerCoverageInput[]): CoverageDistinctRow[] {
  const called = new Map<string, Set<string>>();
  const productive = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, customerId: string) => {
    const set = map.get(key) ?? map.set(key, new Set()).get(key)!;
    set.add(customerId);
  };
  for (const row of rows) {
    const brand = normalizePrincipalKey(row.principal);
    const role = classifyRole(row.salesRole);
    for (const key of [`${brand}|${role}`, `${brand}|${ALL}`, `${ALL}|${role}`, `${ALL}|${ALL}`]) {
      add(called, key, row.customerId);
      if (row.productiveCalls > 0) add(productive, key, row.customerId);
    }
  }
  return [...called.entries()]
    .map(([key, customers]) => {
      const [principalKey, roleCategory] = key.split("|");
      return { year, monthIndex, principalKey, roleCategory, customers: customers.size, productiveCustomers: productive.get(key)?.size ?? 0 };
    })
    .sort((a, b) => a.principalKey.localeCompare(b.principalKey) || a.roleCategory.localeCompare(b.roleCategory));
}

/** Recomputes one month's rollup from CoverageCustomerActual and replaces the stored rows. A month with no customer rows has its rollup removed. */
export async function refreshCoverageDistinctMonth(tx: Prisma.TransactionClient, year: string, monthIndex: number): Promise<number> {
  const customers = await tx.coverageCustomerActual.findMany({
    where: { year, monthIndex },
    select: { principal: true, salesRole: true, customerId: true, productiveCalls: true },
  });
  const rollup = computeCoverageDistinct(year, monthIndex, customers);
  await tx.coverageDistinctMonthly.deleteMany({ where: { year, monthIndex } });
  if (rollup.length > 0) await tx.coverageDistinctMonthly.createMany({ data: rollup });
  return rollup.length;
}
