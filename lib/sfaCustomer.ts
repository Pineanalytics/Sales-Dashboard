// SAP carries two customer names on every sales document: CardName (the billing
// account, often a shared "Cash Customer - <rep>" or "Van 9 - PIGEON" account)
// and U_CustomerName (the outlet the SFA app actually sold to). Customer
// performance only means something at the outlet level, so this resolves the
// SFA name, pulling a trailing phone number out as a contact the way the
// desktop extraction tool does — but only when the bracket really is a phone
// number, so "Country- Near Wa Marto( Ndandora)" keeps its location hint.
import { normalizeCustomerName } from "@/lib/normalize";

export interface SfaCustomerName {
  /** Cleaned outlet name (SFA name, or the account name when SFA left it blank). */
  name: string;
  /** Trailing phone number from the SFA name, "" when none. */
  contact: string;
  source: "SFA" | "ACCOUNT";
}

const TRAILING_BRACKET = /\(([^()]*)\)\s*$/;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikePhone(value: string): boolean {
  if (!/^[0-9+\-\s()]+$/.test(value)) return false;
  return value.replace(/\D/g, "").length >= 9;
}

export function resolveSfaCustomer(sfaName: string | null | undefined, accountName: string): SfaCustomerName {
  const account = collapse(accountName ?? "");
  let name = collapse(sfaName ?? "");
  let contact = "";

  const match = TRAILING_BRACKET.exec(name);
  if (match && looksLikePhone(match[1])) {
    contact = collapse(match[1]);
    name = collapse(name.replace(TRAILING_BRACKET, ""));
  }

  if (!name) return { name: account || "(Unknown Customer)", contact, source: "ACCOUNT" };
  return { name, contact, source: "SFA" };
}

/** Grouping key that merges punctuation/case variants of the same outlet. */
export function sfaCustomerKey(name: string): string {
  return normalizeCustomerName(name);
}
