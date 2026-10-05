// Normalisation rules that make the three outlet sources comparable in one
// module. Pure functions: every rule here is unit-tested and is the single
// place to change when a source starts sending a new channel or segment.

export type OutletSource = "PINE" | "LEVERAGE" | "EABL";

export const OUTLET_SOURCES: OutletSource[] = ["PINE", "LEVERAGE", "EABL"];

export const OUTLET_SOURCE_LABELS: Record<OutletSource, string> = {
  PINE: "Pine",
  LEVERAGE: "Leverage",
  EABL: "EABL DMS",
};

/** An outlet is Active when it bought within this many days. Pine's own rule
 *  (its sweep flips an outlet to Inactive after 60+ days), applied to all sources. */
export const OUTLET_ACTIVE_WINDOW_DAYS = 60;

export const UNSPECIFIED = "Unspecified";

export type OutletSalesRole = "Primary Sales" | "Secondary Sales";

export const OUTLET_SALES_ROLES: OutletSalesRole[] = ["Primary Sales", "Secondary Sales"];

/** Pine stores its role verbatim; anything else (an unseen value) is treated as Primary, the default channel. */
export function normalizeSalesRole(value: string | null | undefined): OutletSalesRole {
  return value === "Secondary Sales" ? "Secondary Sales" : "Primary Sales";
}

/** Records kept out of the Active Outlet module entirely. These are not real trade:
 *  Pine's test territory ("Mars_Test_Territory", "Mars_Test_Territory - MBSR") and
 *  the placeholder "Admin istrator" PJP owner. Matching is on the normalised text,
 *  so spacing and case variants are caught. Add a rule here to hide more; remove
 *  one to bring its outlets back at the next rebuild. */
export const OUTLET_EXCLUSIONS: { reason: string; territory?: RegExp; rep?: RegExp }[] = [
  { reason: "Test territory", territory: /test[_\s]*territory/i },
  { reason: "Admin istrator placeholder rep", rep: /^admin istrator$/i },
];

/** The reason an outlet is hidden, or null when it is kept. */
export function exclusionReason(outlet: { territory: string; repName: string | null }): string | null {
  const territory = clean(outlet.territory);
  const rep = clean(outlet.repName);
  for (const rule of OUTLET_EXCLUSIONS) {
    if ((rule.territory && rule.territory.test(territory)) || (rule.rep && rule.rep.test(rep))) return rule.reason;
  }
  return null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** "001 - On Trade" -> "On Trade"; leaves a value with no code prefix alone. */
export function stripCodePrefix(value: string | null | undefined): string {
  const text = clean(value);
  const match = text.match(/^[A-Za-z0-9]{1,6}\s+-\s+(.+)$/);
  return match ? match[1].trim() : text;
}

/** "DGO-D03-A09-T045 - Nyahururu" -> "Nyahururu". */
export function cleanTerritory(value: string | null | undefined): string {
  let text = stripCodePrefix(value);
  // A hierarchical code (letters, digits and hyphens with at least one digit,
  // e.g. "DGO-D03-A09-T045") before " - " is dropped; a place name that merely
  // contains " - " (Pine's "Tharaka - MBSR") is not a code and stays whole.
  const coded = text.match(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\s+-\s+(.+)$/);
  if (coded && /\d/.test(text.slice(0, text.indexOf(" - ")))) text = coded[1].trim();
  return !text || /^(na|n\/a|unknown|na - unknown)$/i.test(text) ? UNSPECIFIED : text;
}

function titleCase(value: string): string {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

/** Common channel taxonomy: Retail, Wholesale, Modern Trade, On Trade, Other. */
export function normalizeChannel(raw: string | null | undefined): string {
  const text = stripCodePrefix(raw).toLowerCase();
  if (!text || text === "x - not applicable" || text === "not applicable" || text === "x") return UNSPECIFIED;
  if (text === "retail" || text === "retailer" || text === "retailers" || text === "off trade" || text === "beauty") return "Retail";
  if (text === "wholesale" || text === "wholesaler" || text === "wholesalers" || text === "route to market") return "Wholesale";
  if (text === "lmt" || text === "modern trade") return "Modern Trade";
  if (text === "on trade") return "On Trade";
  if (text === "others" || text === "other") return "Other";
  // An unseen value is kept readable rather than silently bucketed.
  return titleCase(clean(stripCodePrefix(raw)));
}

const SEGMENT_ALIASES: Record<string, string> = {
  retail: "Retailers",
  retailer: "Retailers",
  retailers: "Retailers",
  wholesale: "Wholesalers",
  wholesaler: "Wholesalers",
  wholesalers: "Wholesalers",
  lmt: "Large Modern Trade",
  beauty: "Beauty Shop",
  "beauty shop": "Beauty Shop",
  "baby shop": "Baby Shop",
  supermarket: "Supermarkets",
  supermarkets: "Supermarkets",
  "liquor shop": "Liquor Shops",
  "liquor shops": "Liquor Shops",
  pharmacy: "Pharmacies",
  pharmacies: "Pharmacies",
  institution: "Institutions",
  institutions: "Institutions",
  others: "Other",
  "not applicable": UNSPECIFIED,
  "x - not applicable": UNSPECIFIED,
  "e-commerce": "E-Commerce",
};

/** Outlet type / segment. `detail` is the most specific label a source has
 *  (EABL's call segment, e.g. "Bar"); it wins over the coarser `subChannel`. */
export function normalizeSegment(subChannel: string | null | undefined, detail?: string | null): string {
  for (const candidate of [detail, subChannel]) {
    const text = stripCodePrefix(candidate);
    if (!text) continue;
    const alias = SEGMENT_ALIASES[text.toLowerCase()];
    if (alias) return alias;
    return titleCase(text);
  }
  return UNSPECIFIED;
}

/** "Mars-Nairobi" -> "Nairobi"; "Ukl-Intl-Nairobi" -> "Nairobi"; "Mars" -> "Unspecified". */
export function locationFromPrincipal(principal: string): string {
  const parts = clean(principal).split("-");
  return parts.length > 1 ? clean(parts[parts.length - 1]) || UNSPECIFIED : UNSPECIFIED;
}

export function orUnspecified(value: string | null | undefined): string {
  return clean(value) || UNSPECIFIED;
}
