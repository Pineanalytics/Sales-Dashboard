import { prisma } from "@/lib/db";

export interface ProductMappingSuggestion {
  itemNo: string;
  itemDescription: string;
  revenue: number;
  grossMargin: number;
  quantity: number;
  months: string[];
  branches: string[];
  suggestedPrincipal: string | null;
  suggestionReason: string;
}

function productCodePrefix(value: string): string | null {
  return value.trim().match(/^[A-Za-z]+/)?.[0]?.toUpperCase() ?? null;
}

/**
 * Produces review-only Product Master suggestions from the SAP rows that could
 * not be mapped into sales. A single existing principal for the code prefix is
 * accepted as a direct suggestion; a dominant >=95% prefix remains a high-
 * confidence suggestion. Anything weaker stays unassigned for the admin.
 */
export async function getProductMappingSuggestions(): Promise<ProductMappingSuggestion[]> {
  const [sales, products, warehouses] = await Promise.all([
    prisma.unmappedProductSale.findMany({ orderBy: [{ year: "desc" }, { monthIndex: "desc" }] }),
    prisma.product.findMany({ select: { itemNo: true, principal: true } }),
    prisma.warehouse.findMany({ select: { warehouseCode: true, location: true } }),
  ]);

  const locationByWarehouse = new Map(warehouses.map((warehouse) => [warehouse.warehouseCode, warehouse.location]));
  const principalCountsByPrefix = new Map<string, Map<string, number>>();
  for (const product of products) {
    const prefix = productCodePrefix(product.itemNo);
    if (!prefix || !product.principal.trim()) continue;
    const principalCounts = principalCountsByPrefix.get(prefix) ?? new Map<string, number>();
    principalCounts.set(product.principal, (principalCounts.get(product.principal) ?? 0) + 1);
    principalCountsByPrefix.set(prefix, principalCounts);
  }

  const byItemNo = new Map<string, {
    itemNo: string; itemDescription: string; revenue: number; grossMargin: number; quantity: number;
    months: Set<string>; warehouseCodes: Set<string>;
  }>();
  for (const sale of sales) {
    const current = byItemNo.get(sale.itemNo) ?? {
      itemNo: sale.itemNo, itemDescription: sale.itemDescription, revenue: 0, grossMargin: 0, quantity: 0,
      months: new Set<string>(), warehouseCodes: new Set<string>(),
    };
    current.revenue += sale.revenue;
    current.grossMargin += sale.grossMargin;
    current.quantity += sale.quantity;
    current.months.add(`${sale.year}-${String(sale.monthIndex + 1).padStart(2, "0")}`);
    if (sale.warehouseCode) current.warehouseCodes.add(sale.warehouseCode);
    byItemNo.set(sale.itemNo, current);
  }

  return Array.from(byItemNo.values()).map((item) => {
    const prefix = productCodePrefix(item.itemNo);
    const principalCounts = prefix ? principalCountsByPrefix.get(prefix) : undefined;
    const ranked = principalCounts ? Array.from(principalCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) : [];
    const totalMatches = ranked.reduce((total, [, count]) => total + count, 0);
    const [topPrincipal, topCount] = ranked[0] ?? [null, 0];
    const confidence = totalMatches ? topCount / totalMatches : 0;
    const suggestedPrincipal = topPrincipal && (ranked.length === 1 || confidence >= 0.95) ? topPrincipal : null;
    const suggestionReason = !prefix
      ? "No alphabetic item-code prefix is available for a safe suggestion."
      : !topPrincipal
        ? `No existing Product Master code begins with ${prefix}.`
        : suggestedPrincipal
          ? ranked.length === 1
            ? `${prefix} prefix maps only to ${topPrincipal} in Product Master (${topCount} existing codes).`
            : `${prefix} prefix maps to ${topPrincipal} for ${(confidence * 100).toFixed(1)}% of ${totalMatches} existing codes.`
          : `${prefix} prefix is split across ${ranked.length} principals; review required.`;

    return {
      itemNo: item.itemNo,
      itemDescription: item.itemDescription,
      revenue: item.revenue,
      grossMargin: item.grossMargin,
      quantity: item.quantity,
      months: Array.from(item.months).sort(),
      branches: Array.from(item.warehouseCodes).map((code) => locationByWarehouse.get(code) ?? code).filter((value, index, values) => values.indexOf(value) === index).sort(),
      suggestedPrincipal,
      suggestionReason,
    };
  }).sort((a, b) => Math.abs(b.revenue) - Math.abs(a.revenue) || a.itemNo.localeCompare(b.itemNo));
}
