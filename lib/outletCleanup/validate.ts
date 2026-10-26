// The rules a cleanup entry has to satisfy before it is saved. Pure, so the form (browser) and the API (server) apply the very same checks:
// values come from the existing lists only (no free text where a list exists), contact details are normalised, a GPS tag must be a real,
// accurate point in Kenya, and a field that has been updated or confirmed is locked.
import { IDENTIFICATION_FIELDS, type CleanupOptions, type IdentificationField, type LockableField } from "./types";

/** A phone's GPS fix must be at least this accurate (metres) to tag an outlet: a looser fix can be a street away. */
export const MAX_GEO_ACCURACY_M = 100;
/** A tag further than this from the point already held is accepted but flagged for the admin's check. */
export const GEO_MOVE_WARNING_M = 500;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(a));
}

/** A Kenyan mobile number in the form +2547XXXXXXXX (or +2541XXXXXXXX), or null when the text is not one. Accepts 07.., 01.., 7.., 2547.. and +2547.. with spaces or dashes. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = String(input ?? "").replace(/[\s\-().]/g, "");
  const match = digits.match(/^(?:\+?254|0)?([71]\d{8})$/);
  return match ? `+254${match[1]}` : null;
}

/** A person's name with spacing tidied, or null when it is not a plausible name (letters, spaces, . ' - only; 2 to 60 characters). */
export function cleanContactName(input: string): string | null {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 60 && /^[\p{L}][\p{L}\s.'-]*$/u.test(name) ? name : null;
}

/** The option the value stands for, ignoring case and spacing, or null when it is not on the list. */
export function matchOption(value: string, options: readonly string[]): string | null {
  const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const wanted = fold(String(value ?? ""));
  return wanted === "" ? null : options.find((option) => fold(option) === wanted) ?? null;
}

export type GeoCheck = { ok: true; distanceM: number | null; farFromPrevious: boolean } | { ok: false; error: string };

/** Whether a tag from a phone can be accepted: a real point in Kenya, accurate enough. */
export function checkGeoTag(tag: { latitude: number; longitude: number; accuracyM: number }, previous: { latitude: number | null; longitude: number | null }): GeoCheck {
  const { latitude, longitude, accuracyM } = tag;
  if (![latitude, longitude, accuracyM].every((n) => typeof n === "number" && Number.isFinite(n))) return { ok: false, error: "The location was not readable. Allow location access and try again." };
  if (latitude === 0 || longitude === 0 || latitude < -5 || latitude > 5 || longitude < 33 || longitude > 43) return { ok: false, error: "That point is not in Kenya. Tag the outlet from the outlet itself." };
  if (accuracyM > MAX_GEO_ACCURACY_M) return { ok: false, error: `The phone's fix is only accurate to ${Math.round(accuracyM)} m; it must be within ${MAX_GEO_ACCURACY_M} m. Step outside or wait a moment and tag again.` };
  const distanceM = previous.latitude !== null && previous.longitude !== null && previous.latitude !== 0 ? haversineM(latitude, longitude, previous.latitude, previous.longitude) : null;
  return { ok: true, distanceM: distanceM === null ? null : Math.round(distanceM), farFromPrevious: distanceM !== null && distanceM > GEO_MOVE_WARNING_M };
}

export interface IdentificationRequest {
  /** New values for fields the team leader changed (a value equal to the current one is a confirmation). */
  set?: Partial<Record<IdentificationField, string>>;
  /** Fields confirmed as correct as they are. "ALL" confirms every identification field that has a value. */
  confirm?: IdentificationField[] | "ALL";
}

export interface IdentificationPlan {
  /** Values to store as verified (only those that differ from the universe's). */
  values: Partial<Record<IdentificationField, string>>;
  /** Fields that become locked (updated or confirmed). */
  lock: IdentificationField[];
  errors: { field: IdentificationField; message: string }[];
}

/** Turns a request into the values to store and the fields to lock, refusing anything that is not on a list, not valid, or already locked. */
export function planIdentification(input: {
  /** What the universe has. */
  current: Record<IdentificationField, string>;
  /** What the team leader had already verified. */
  verified: Partial<Record<IdentificationField, string>>;
  locked: readonly LockableField[];
  request: IdentificationRequest;
  options: CleanupOptions;
  /** An admin or supervisor can change a locked field. */
  canUnlock: boolean;
}): IdentificationPlan {
  const { current, verified, locked, request, options, canUnlock } = input;
  const values: Partial<Record<IdentificationField, string>> = {};
  const lock = new Set<IdentificationField>();
  const errors: IdentificationPlan["errors"] = [];
  const listFor: Partial<Record<IdentificationField, readonly string[]>> = { region: options.regions, territory: options.territories, channel: options.channels, customerType: options.customerTypes };
  const effective = (field: IdentificationField) => (verified[field] ?? current[field] ?? "").trim();
  const isLocked = (field: IdentificationField) => locked.includes(field);

  for (const field of IDENTIFICATION_FIELDS) {
    const wanted = request.set?.[field];
    if (wanted === undefined) continue;
    if (isLocked(field) && !canUnlock) {
      errors.push({ field, message: "Already updated, so it is locked. Ask your supervisor or an admin to reopen it." });
      continue;
    }
    const text = String(wanted).trim();
    let normalised: string | null;
    if (field === "contactPhone") normalised = text === "" ? "" : normalizeKenyanPhone(text);
    else if (field === "contactName") normalised = text === "" ? "" : cleanContactName(text);
    else normalised = matchOption(text, listFor[field] ?? []);
    if (normalised === null) {
      errors.push({
        field,
        message: field === "contactPhone" ? "Enter a Kenyan mobile number, for example 0712 345 678." : field === "contactName" ? "Enter the contact's name in letters." : "Choose a value from the list.",
      });
      continue;
    }
    if (normalised === "") {
      errors.push({ field, message: "Leave it as it is, or choose a value." });
      continue;
    }
    if (normalised.toLowerCase() !== effective(field).toLowerCase()) values[field] = normalised;
    lock.add(field);
  }

  const confirmFields = request.confirm === "ALL" ? (IDENTIFICATION_FIELDS.filter((f) => effective(f) !== "" && !(f === "contactName" || f === "contactPhone"))) : (request.confirm ?? []);
  for (const field of confirmFields) {
    if (isLocked(field)) continue; // already settled
    if (effective(field) === "") {
      errors.push({ field, message: "There is nothing here to confirm. Enter the correct value." });
      continue;
    }
    lock.add(field);
  }
  return { values, lock: [...lock], errors };
}
