// How Mars is organised into regions and sub-regions, and the defaults every other principal uses.
//
// Mars has three regions, each split into the sub-regions its Team Leaders own (the Mars KPI roster's "Location"):
//    Nairobi  - Nairobi Lower, Nairobi Metro, Nairobi South (and Nairobi Key Accounts, which has no Team Leader of its own)
//    Eastern  - Lower Eastern, Upper Eastern
//    Central  - Central
// Targets are set and reported against these sub-regions. Every other principal is not split that way: its reps default to
// Nairobi Metro in Nairobi, Upper Eastern in Eastern and Central in Central.

export const MARS_PRINCIPAL = "Mars-Nairobi";

/** Mars region -> its sub-regions, in reporting order. */
export const MARS_REGIONS: Readonly<Record<string, readonly string[]>> = {
  Nairobi: ["Nairobi Lower", "Nairobi Metro", "Nairobi South"],
  Eastern: ["Lower Eastern", "Upper Eastern"],
  Central: ["Central"],
};

/** The key accounts team sits in Nairobi but is not one of its three sub-regions: it reports to Mars's supervisor directly. */
export const MARS_KEY_ACCOUNTS_SUB_REGION = "Nairobi Key Accounts";
export const MARS_KEY_ACCOUNTS_REGION = "Nairobi";

/** The sub-region a rep of any principal other than Mars gets when none is set, by region. */
export const DEFAULT_SUB_REGION: Readonly<Record<string, string>> = {
  Nairobi: "Nairobi Metro",
  Eastern: "Upper Eastern",
  Central: "Central",
};

export function isMarsPrincipal(principal: string): boolean {
  return /^mars/i.test(principal.trim());
}

/** The Mars region a sub-region belongs to, or null when it is not one of Mars's. */
export function marsRegionOf(subRegion: string | null | undefined): string | null {
  const wanted = (subRegion ?? "").trim().toLowerCase();
  if (wanted === "") return null;
  if (wanted === MARS_KEY_ACCOUNTS_SUB_REGION.toLowerCase()) return MARS_KEY_ACCOUNTS_REGION;
  for (const [region, subs] of Object.entries(MARS_REGIONS)) if (subs.some((sub) => sub.toLowerCase() === wanted)) return region;
  return null;
}

/** Whether a Mars region and sub-region belong together. */
export function isValidMarsPlacement(region: string, subRegion: string): boolean {
  return marsRegionOf(subRegion)?.toLowerCase() === region.trim().toLowerCase();
}

/** The sub-region options a Mars region offers (the key accounts team is added to Nairobi's). */
export function marsSubRegionsOf(region: string): string[] {
  const key = Object.keys(MARS_REGIONS).find((name) => name.toLowerCase() === region.trim().toLowerCase());
  if (!key) return [];
  return key === MARS_KEY_ACCOUNTS_REGION ? [...MARS_REGIONS[key], MARS_KEY_ACCOUNTS_SUB_REGION] : [...MARS_REGIONS[key]];
}

/** The sub-region to use when a rep has none: Mars reps have no default (they are placed from the Mars roster), other principals
 *  default by region. Null when there is nothing sensible to default to. */
export function defaultSubRegion(principal: string, region: string | null | undefined): string | null {
  if (isMarsPrincipal(principal)) return null;
  const key = Object.keys(DEFAULT_SUB_REGION).find((name) => name.toLowerCase() === (region ?? "").trim().toLowerCase());
  return key ? DEFAULT_SUB_REGION[key] : null;
}
