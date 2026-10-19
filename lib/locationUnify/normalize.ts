// Location names in the outlet systems are free text: "THIKA", "Thika", "Nairobi-Thika", "Thika - MBSR", "AA Imara Daima", "Imara", plus Google plus-code
// addresses ("Qv9g+Jr9, Thika Rd, Nairobi, Kenya"). This reduces a raw name to a comparable key and says what kind of name it is.

export type LocationKind = "place" | "address" | "unspecified";

export interface NormalizedLocation {
  raw: string;
  /** Comparable key: lower case, punctuation and noise removed, e.g. "imara daima". Empty for an address or an unspecified name. */
  key: string;
  tokens: string[];
  kind: LocationKind;
}

/** Tag and filler words that carry no place information. "mbsr" is the Mars distributor tag appended to some territories. */
const NOISE_TOKENS = new Set(["mbsr", "county", "kenya", "sub"]);
/** City words dropped when they only prefix a place ("Nairobi-Imara" is Imara); a name that is only the city stays. */
const CITY_PREFIXES = new Set(["nairobi", "nrb"]);
const UNSPECIFIED = new Set(["unspecified", "unknown", "na", "n a", "none", "other", "null", "undefined", "not specified"]);

/** Words that make "A B" a different place from "A" (a direction, a road, a phase, a numbered stage) rather than another spelling of it. */
export const DISTINGUISHING_TOKENS = new Set([
  "north", "south", "east", "west", "central", "upper", "lower", "extension", "ext", "phase", "estate", "road", "rd", "avenue", "ave", "street", "st", "lane", "ln",
  "junction", "stage", "market", "town", "centre", "center", "bypass", "highway", "hwy", "mall", "plaza", "gate", "roundabout", "round", "bridge",
]);

const PLUS_CODE = /\b[0-9a-z]{4,}\+[0-9a-z]{2,}/i;

export function normalizeLocation(raw: string): NormalizedLocation {
  const text = String(raw ?? "").trim();
  const base: NormalizedLocation = { raw: text, key: "", tokens: [], kind: "place" };
  if (text === "") return { ...base, kind: "unspecified" };
  // A plus code, or an address with a comma and the country, is an address a person or map app typed, not a place name.
  if (PLUS_CODE.test(text) || (text.includes(",") && /\b(kenya|nairobi|ruiru|thika)\b/i.test(text))) return { ...base, kind: "address" };

  const ascii = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "");
  let tokens = ascii.split(/[^a-z0-9]+/).filter(Boolean);
  // A leading run of "aa" / "aaa" is a sort prefix ("AA Imara Daima").
  while (tokens.length > 1 && /^a{2,}$/.test(tokens[0])) tokens.shift();
  tokens = tokens.filter((t) => !NOISE_TOKENS.has(t));
  if (tokens.length > 1 && CITY_PREFIXES.has(tokens[0])) tokens = tokens.slice(1);
  // "nairobi aa imara": the sort prefix can also follow the city.
  while (tokens.length > 1 && /^a{2,}$/.test(tokens[0])) tokens.shift();
  const key = tokens.join(" ");
  if (key === "" || UNSPECIFIED.has(key)) return { ...base, key: "", tokens: [], kind: "unspecified" };
  return { raw: text, key, tokens, kind: "place" };
}

const ACRONYMS = new Set(["cbd", "jkia", "uon", "kcb", "eabl", "ilasit"]);

/** "imara daima" -> "Imara Daima" (known acronyms stay upper case). */
export function displayName(key: string): string {
  return key
    .split(" ")
    .map((t) => (ACRONYMS.has(t) ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1)))
    .join(" ");
}
