// SKU -> brand mapping for the Stock screens and the cover targets.
//
// SAP carries no usable brand: its "Brand/Manufacturer" field is the company ("UPFIEL Kenya Limited") or the placeholder
// "-Select Manufacturer-" (974 of 1,230 stocked SKUs), and Product Master's series holds numeric codes. So a SKU's brand is
// worked out from its principal and its name, in this order:
//   1. rules added by an admin (StockBrandRule, /admin/stock-brands), longest keyword first;
//   2. the default rules below (abbreviations and multi-word brands the plain rule below gets wrong);
//   3. the first real word of the name, title-cased ("SUNLIGHT 1kg" -> "Sunlight").
// A rule matches a normalised name (lower case, single spaces) either at its start (PREFIX, the default) or anywhere
// (CONTAINS), and belongs to one principal key ("eabl", "mars", ...). A SKU nothing can name is "Unspecified".
//
// Returnable empties (crates, bottles) are not products to cover: isEmptiesItem() picks them out so they can be left out
// of the operational Stock Balance.

export type BrandRuleMode = "PREFIX" | "CONTAINS";

export interface BrandRule {
  /** normalizePrincipalKey of the principal the rule belongs to, e.g. "eabl". */
  principalKey: string;
  keyword: string;
  brand: string;
  mode: BrandRuleMode;
}

const p = (principalKey: string, keyword: string, brand: string, mode: BrandRuleMode = "PREFIX"): BrandRule => ({ principalKey, keyword, brand, mode });

/** Built-in rules: the abbreviations and multi-word brands seen in the SAP item names. An admin can add more (or override any of
 *  these by adding a longer keyword) on /admin/stock-brands. */
export const DEFAULT_BRAND_RULES: BrandRule[] = [
  // EABL: SAP names are abbreviated
  p("eabl", "tusker", "Tusker"),
  p("eabl", "guinness", "Guinness"),
  p("eabl", "whitecap", "Whitecap"),
  p("eabl", "balozi", "Balozi"),
  p("eabl", "chrome", "Chrome"),
  p("eabl", "kenya cane", "Kenya Cane"),
  p("eabl", "kenyacane", "Kenya Cane"),
  p("eabl", "kane", "Kenya Cane"),
  p("eabl", "jw", "Johnnie Walker"),
  p("eabl", "johnnie", "Johnnie Walker"),
  p("eabl", "smir", "Smirnoff"),
  p("eabl", "tanq", "Tanqueray"),
  p("eabl", "gordon", "Gordon's"),
  p("eabl", "gord", "Gordon's"),
  p("eabl", "cptmrg", "Captain Morgan"),
  p("eabl", "cptn", "Captain Morgan"),
  p("eabl", "captain", "Captain Morgan"),
  p("eabl", "gilbey", "Gilbey's"),
  p("eabl", "baileys", "Baileys"),
  p("eabl", "pilsner", "Pilsner"),
  p("eabl", "vat", "VAT 69"),
  p("eabl", "richot", "Richot"),
  p("eabl", "bond", "Bond 7"),
  p("eabl", "snapp", "Snapp"),
  p("eabl", "triple", "Triple Ace"),
  p("eabl", "manyatta", "Manyatta"),
  p("eabl", "dtown", "Dtown"),
  p("eabl", "ketel", "Ketel One"),
  p("eabl", "ciroc", "Ciroc"),
  // Mars
  p("mars", "p.k", "PK"),
  p("mars", "pk ", "PK"),
  p("mars", "jcy", "Juicy Fruit"),
  p("mars", "juicy", "Juicy Fruit"),
  p("mars", "orbit", "Orbit"),
  // Upfield
  p("upfield", "blue band", "Blue Band"),
  p("upfield", "blue", "Blue Band"),
  p("upfield", "rama", "Rama"),
  p("upfield", "flora", "Flora"),
  // Unilever and Unilever International
  p("unilever", "close up", "Close Up"),
  p("unilever", "close", "Close Up"),
  p("ukl", "close up", "Close Up"),
  p("ukl", "close", "Close Up"),
  // Others whose first word is not the brand
  p("millyfruits", "picana", "Picana", "CONTAINS"),
  p("bic", "cristal", "Cristal"),
  p("bic", "bic", "Bic"),
  p("suntory", "ribena", "Ribena"),
  p("suntory", "luc", "Lucozade"),
  p("tropikal", "tropikal", "Tropikal"),
  p("tropikal", "tropical", "Tropikal"),
  p("bidco", "afripop", "Afripop"),
];

const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, " ").trim();

/** The SAP placeholder for "no manufacturer chosen": not a brand. */
export function isPlaceholderBrand(brand: string | null | undefined): boolean {
  const text = (brand ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return text === "" || text === "selectmanufacturer";
}

/** A returnable empty (crate, bottle, shell): packaging that comes back, not stock to sell or cover. */
export function isEmptiesItem(itemName: string | null | undefined): boolean {
  return /\bempt(y|ies)\b/i.test(itemName ?? "");
}

const SIZE_OR_NOISE = /^(\d|[-+*\/&(]|x\d)/;

/** The first word of a name that looks like a brand: skips pack sizes, symbols and one-letter words. Null when there is none. */
export function firstWordBrand(itemName: string): string | null {
  for (const raw of norm(itemName).split(" ")) {
    const word = raw.replace(/[^a-z0-9'.&]/g, "").replace(/^[.']+|[.']+$/g, "");
    if (word.length < 2 || SIZE_OR_NOISE.test(word)) continue;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return null;
}

export interface MappedBrand {
  brand: string;
  /** "rule": an admin or default rule named it; "auto": taken from the first word of the name; "none": nothing could name it. */
  source: "rule" | "auto" | "none";
}

/** The brand of one SKU. `rules` are tried longest keyword first; admin rules before the defaults at equal length. */
export function mapSkuBrand(principalKey: string, itemName: string | null | undefined, adminRules: BrandRule[] = []): MappedBrand {
  const name = norm(itemName ?? "");
  if (name === "") return { brand: "Unspecified", source: "none" };
  const candidates = [...adminRules.map((rule) => ({ rule, admin: true })), ...DEFAULT_BRAND_RULES.map((rule) => ({ rule, admin: false }))]
    .filter(({ rule }) => rule.principalKey === principalKey)
    .sort((a, b) => b.rule.keyword.length - a.rule.keyword.length || Number(b.admin) - Number(a.admin));
  for (const { rule } of candidates) {
    const keyword = norm(rule.keyword);
    if (keyword === "") continue;
    const matches = rule.mode === "CONTAINS" ? name.includes(keyword) : name.startsWith(keyword);
    if (matches) return { brand: rule.brand, source: "rule" };
  }
  const auto = firstWordBrand(name);
  return auto ? { brand: auto, source: "auto" } : { brand: "Unspecified", source: "none" };
}
