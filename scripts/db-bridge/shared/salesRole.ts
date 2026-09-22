// Canonical Primary/Secondary Sales Role classification, shared by every
// bridge that reads the Pine field-force DB. This is the precise rule
// ported from the user-supplied Buying_Outlets_By_CostCentre_Extractor
// Python script (classify_sales_role, lines 975-996) - originally built
// only for Active Outlets/Timestamps, while the Coverage bridge kept its
// own older, simplified MBSR/TDR-only rule. Unified onto this one 2026-09-22
// so "Primary"/"Secondary" mean the same set of reps everywhere in the app,
// not a different set depending on which bridge/page you're looking at.
const PRIMARY_GROUPS = new Set(["DSR", "KAMS", "TDR", "ADMIN"]);
const SECONDARY_DSR_CODES = new Set(["1172", "1032"]);
const MARS_COST_CENTRE = "mars";

/** costCentre may be the bare brand ("Mars") or a location-suffixed principal
 *  string ("Mars-Nairobi"), and may be a comma-joined basket of several (a
 *  single call/row spanning multiple Cost Centres) - checked with
 *  startsWith/some so any of those forms correctly match Mars. */
export function classifySalesRole(userGroup: string, userId: string, costCentre: string): "Primary Sales" | "Secondary Sales" {
  const group = userGroup.trim().toUpperCase();
  const isPrimaryGroup = PRIMARY_GROUPS.has(group);
  // A TDR call can contain several Cost Centres. Treat the whole call as
  // Secondary when any product in that basket belongs to Mars, rather than
  // letting whichever product happened to be processed first decide its role.
  const excludedTdrMars = group === "TDR" && costCentre.split(",").some((centre) => centre.trim().toLowerCase().startsWith(MARS_COST_CENTRE));
  const excludedDsrCode = group === "DSR" && SECONDARY_DSR_CODES.has(userId.trim());
  return isPrimaryGroup && !excludedTdrMars && !excludedDsrCode ? "Primary Sales" : "Secondary Sales";
}
