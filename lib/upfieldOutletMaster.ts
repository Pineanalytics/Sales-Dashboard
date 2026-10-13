// Upfield's official outlet list ("customer master"), the DataEdge export "OutletsList_KDwise_<date>.xlsx": one row per outlet with its code,
// name, type, channel, route (FSR, day and week), GPS point, location and contact. It is the universe Upfield's coverage is measured against
// and the source of each outlet's channel / type, which the DataEdge sales feed (UpfieldTransaction) does not carry.
//
// The file starts with a banner row ("From: ... To: ...") above the real header row, so the header row is found rather than assumed.
// Matching to sales is by Outlet_Code = UpfieldTransaction.custCode.
import * as XLSX from "xlsx";
import { kenyaCoordinate } from "./outletUniverse/normalize";

export interface UpfieldOutletMasterRow {
  outletCode: string;
  outletName: string;
  company: string | null;
  contactName: string | null;
  phone: string | null;
  outletType: string | null;
  channel: string | null;
  territory: string | null;
  fsrName: string | null;
  fsrLogin: string | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  routeDay: string | null;
  routeWeek: string | null;
}

export interface UpfieldOutletMasterParse {
  rows: UpfieldOutletMasterRow[];
  /** Plain-language notes about rows that were skipped, merged or cleaned. */
  warnings: string[];
}

export class UpfieldMasterParseError extends Error {}

const squash = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();
const keyOf = (header: unknown): string => squash(header).toLowerCase().replace(/[^a-z0-9]/g, "");
const orNull = (value: unknown): string | null => squash(value) || null;

/** "Brian Mwaura (Dolphine.Pinefrost)" -> name "Brian Mwaura", login "Dolphine.Pinefrost". */
export function splitFsr(value: unknown): { name: string | null; login: string | null } {
  const text = squash(value);
  if (!text) return { name: null, login: null };
  const match = text.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!match) return { name: text, login: null };
  return { name: squash(match[1]) || null, login: squash(match[2]) || null };
}

/** "-1.3920458,36.9403915" (a stray trailing comma is tolerated) -> a coordinate inside Kenya, else null. */
export function parseGeoPoint(value: unknown): { latitude: number; longitude: number } | null {
  const parts = squash(value).split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return kenyaCoordinate(latitude, longitude);
}

const REQUIRED = ["outletcode", "outletname"];

/** Reads the outlet list workbook. Throws UpfieldMasterParseError when it is not the outlet list (no Outlet_Code / Outlet_Name header). */
export function parseUpfieldOutletMaster(buffer: ArrayBuffer | Buffer): UpfieldOutletMasterParse {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new UpfieldMasterParseError("The file could not be read as an Excel workbook.");
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new UpfieldMasterParseError("The workbook has no sheets.");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });

  let headerIndex = -1;
  for (let i = 0; i < Math.min(grid.length, 15); i++) {
    const keys = grid[i].map(keyOf);
    if (REQUIRED.every((name) => keys.includes(name))) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) throw new UpfieldMasterParseError('This is not the Upfield outlet list: no header row with "Outlet_Code" and "Outlet_Name" was found.');

  const column = new Map<string, number>();
  grid[headerIndex].forEach((header, index) => {
    const key = keyOf(header);
    if (key && !column.has(key)) column.set(key, index);
  });
  const cell = (row: unknown[], name: string): unknown => {
    const index = column.get(name);
    return index === undefined ? "" : row[index];
  };

  const rows = new Map<string, UpfieldOutletMasterRow>();
  const warnings: string[] = [];
  let blankCode = 0;
  let duplicates = 0;
  let badGeo = 0;
  let noGeo = 0;
  for (const raw of grid.slice(headerIndex + 1)) {
    const outletCode = squash(cell(raw, "outletcode"));
    if (!outletCode) {
      if (raw.some((value) => squash(value))) blankCode += 1;
      continue;
    }
    const geoText = squash(cell(raw, "geopoint"));
    const geo = parseGeoPoint(geoText);
    if (!geoText) noGeo += 1;
    else if (!geo) badGeo += 1;
    const fsr = splitFsr(cell(raw, "routefsr"));
    if (rows.has(outletCode)) duplicates += 1;
    rows.set(outletCode, {
      outletCode,
      outletName: squash(cell(raw, "outletname")) || outletCode,
      company: orNull(cell(raw, "company")),
      contactName: orNull(cell(raw, "contactname")),
      phone: orNull(cell(raw, "phone")),
      outletType: orNull(cell(raw, "type")),
      channel: orNull(cell(raw, "channel")),
      territory: orNull(cell(raw, "territory")),
      fsrName: fsr.name,
      fsrLogin: fsr.login,
      location: orNull(cell(raw, "location")),
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      routeDay: orNull(cell(raw, "routeday"))?.toLowerCase() ?? null,
      routeWeek: orNull(cell(raw, "routeweek")),
    });
  }
  if (rows.size === 0) throw new UpfieldMasterParseError("The outlet list has a header but no outlets.");
  if (blankCode > 0) warnings.push(`${blankCode} row(s) with no Outlet_Code were skipped.`);
  if (duplicates > 0) warnings.push(`${duplicates} duplicate Outlet_Code row(s): the last one in the file was kept.`);
  if (badGeo > 0) warnings.push(`${badGeo} outlet(s) have a GPS point outside Kenya or unreadable: no coordinates stored for them.`);
  if (noGeo > 0) warnings.push(`${noGeo} outlet(s) have no GPS point.`);
  return { rows: Array.from(rows.values()), warnings };
}

/** Breakdown of a parsed list for the upload summary: counts by channel, type and FSR. */
export function summarizeUpfieldOutletMaster(rows: UpfieldOutletMasterRow[]): { byChannel: [string, number][]; byType: [string, number][]; byFsr: [string, number][] } {
  const count = (pick: (row: UpfieldOutletMasterRow) => string | null): [string, number][] => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = pick(row) ?? "Unspecified";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map).sort((a, b) => b[1] - a[1]);
  };
  return { byChannel: count((r) => r.channel), byType: count((r) => r.outletType), byFsr: count((r) => r.fsrName) };
}
