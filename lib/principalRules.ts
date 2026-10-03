// Item-code/name rules that propose a principal for a SAP item. Adapted from the
// desktop "SAP B1 Detailed Sales Extraction" tool (PRINCIPALS / NAME_PRINCIPALS).
// These rules only ever SUGGEST: the Product Master stays authoritative for the
// existing sales pipeline, and an admin approves any change to it.
import { normalizePrincipalKey } from "@/lib/normalize";

export interface PrincipalRule {
  principal: string;
  /** "code" matches the SAP ItemCode; "name" matches the SAP ItemName. */
  field: "code" | "name";
  prefix: string;
}

// Name rules run first: a principal can distribute under another principal's
// item-code series (Bidco's Afripop is coded SUN…, in Suntory's range).
export const DEFAULT_PRINCIPAL_RULES: PrincipalRule[] = [
  { principal: "Bidco", field: "name", prefix: "AFRIPOP" },
  { principal: "Bic", field: "code", prefix: "BIC" },
  { principal: "Delmonte", field: "code", prefix: "DEL" },
  { principal: "DKT", field: "code", prefix: "DKT" },
  { principal: "Durex", field: "code", prefix: "DUREX" },
  { principal: "EABL", field: "code", prefix: "KBL" },
  { principal: "EABL", field: "code", prefix: "UDV" },
  { principal: "EFL", field: "code", prefix: "CEY" },
  { principal: "Energia", field: "code", prefix: "EPL" },
  { principal: "Elex", field: "code", prefix: "ELX" },
  { principal: "Godrej", field: "code", prefix: "GDJ" },
  { principal: "Jumra", field: "code", prefix: "JMR" },
  { principal: "Mars", field: "code", prefix: "MARS" },
  { principal: "Movit", field: "code", prefix: "MOV" },
  { principal: "Nestle", field: "code", prefix: "NES" },
  { principal: "Premier", field: "code", prefix: "PREM" },
  { principal: "Promasidor", field: "code", prefix: "PROM" },
  { principal: "Signify", field: "code", prefix: "SIG" },
  { principal: "Suntory", field: "code", prefix: "SUN" },
  { principal: "Tropikal", field: "code", prefix: "TPL" },
  { principal: "Ukl-Intl", field: "code", prefix: "KMFY" },
  { principal: "Unilever", field: "code", prefix: "UKL" },
  { principal: "Upfield", field: "code", prefix: "UP" },
  { principal: "Weetabix", field: "code", prefix: "WEET" },
  { principal: "Bennet", field: "code", prefix: "BNT" },
  { principal: "Milly Fruits", field: "code", prefix: "PIC" },
];

export const UNALLOCATED_PRINCIPAL = "Unallocated";

function isUpperAlpha(char: string | undefined): boolean {
  return char !== undefined && char >= "A" && char <= "Z";
}

/** Code prefixes match "whole word": UP matches UP00012 but not UPLIFT01, so a
 *  short prefix can't swallow an unrelated longer series. */
function codeMatches(itemCode: string, prefix: string): boolean {
  const value = itemCode.trimStart().toUpperCase();
  if (!value.startsWith(prefix)) return false;
  return !isUpperAlpha(value[prefix.length]);
}

function nameMatches(itemName: string, prefix: string): boolean {
  return itemName.trimStart().toUpperCase().startsWith(prefix);
}

export interface PrincipalAllocation {
  principal: string;
  rule: PrincipalRule | null;
}

/** Name rules first, then the longest matching code prefix; no match is
 *  "Unallocated" so callers can surface it instead of dropping it. */
export function allocatePrincipal(
  itemCode: string | null | undefined,
  itemName: string | null | undefined,
  rules: PrincipalRule[] = DEFAULT_PRINCIPAL_RULES
): PrincipalAllocation {
  for (const rule of rules) {
    if (rule.field === "name" && itemName && nameMatches(itemName, rule.prefix.toUpperCase())) {
      return { principal: rule.principal, rule };
    }
  }
  const codeRules = rules.filter((rule) => rule.field === "code").sort((a, b) => b.prefix.length - a.prefix.length);
  for (const rule of codeRules) {
    if (itemCode && codeMatches(itemCode, rule.prefix.toUpperCase())) return { principal: rule.principal, rule };
  }
  return { principal: UNALLOCATED_PRINCIPAL, rule: null };
}

export interface ProductPrincipalConflict {
  itemNo: string;
  itemDescription: string;
  currentPrincipal: string;
  suggestedPrincipal: string;
  rule: PrincipalRule;
}

/** Products whose Product Master principal disagrees with a rule. Compared on
 *  normalizePrincipalKey so "Suntory" vs "Suntory-Nairobi" never reads as a
 *  conflict; a product with no matching rule is never flagged. */
export function findProductPrincipalConflicts(
  products: { itemNo: string; itemDescription: string | null; principal: string }[],
  rules: PrincipalRule[] = DEFAULT_PRINCIPAL_RULES
): ProductPrincipalConflict[] {
  const conflicts: ProductPrincipalConflict[] = [];
  for (const product of products) {
    const allocation = allocatePrincipal(product.itemNo, product.itemDescription, rules);
    if (!allocation.rule) continue;
    if (!product.principal.trim()) continue;
    if (normalizePrincipalKey(allocation.principal) === normalizePrincipalKey(product.principal)) continue;
    conflicts.push({
      itemNo: product.itemNo,
      itemDescription: product.itemDescription ?? "",
      currentPrincipal: product.principal,
      suggestedPrincipal: allocation.principal,
      rule: allocation.rule,
    });
  }
  return conflicts.sort((a, b) => a.itemNo.localeCompare(b.itemNo));
}
