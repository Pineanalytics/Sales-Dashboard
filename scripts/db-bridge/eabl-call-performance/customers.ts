// EABL customer master query + transform. Separate from run.ts's own live
// call-level query (60s cadence) — this is reference/master data, synced
// far less often, on its own schedule (see run.ts's wiring).
//
// Source: PinefrostAnalytics.MasterData.Customers, same SQL Server the call
// bridge already connects to (EABL_CALL_SQL_* — no new credentials). Scoped
// to only customers with real DSR_Calls activity (~817 of the master's
// 1,010 rows, confirmed live) — the master table also carries other areas
// ("Mountain KSO", "Offtrade") with nothing to do with EABL-Nyeri/Nyahururu.
import type { ConnectionPool } from "mssql";

export interface EablCustomerRow {
  customerId: string;
  outletName: string;
  channel: string | null;
  subChannel: string | null;
  territory: string | null;
  gpsCoordinate: string | null;
  status: string;
}

interface SourceCustomer {
  customerId: string;
  outletName: string;
  channel: string | null;
  subChannel: string | null;
  territory: string | null;
  gpsCoordinate: string | null;
  status: string;
}

export async function fetchEablCustomers(pool: ConnectionPool): Promise<EablCustomerRow[]> {
  const result = await pool.request().query<SourceCustomer>(`
    SELECT m.DMSCustomerCode AS customerId, m.CustomerName AS outletName, m.GlobalChannel AS channel,
      m.SubChannel AS subChannel, m.Territory AS territory, m.GPSCoordinate AS gpsCoordinate, m.CustomerStatus AS status
    FROM PinefrostAnalytics.MasterData.Customers m
    WHERE m.DMSCustomerCode IS NOT NULL AND LTRIM(RTRIM(m.DMSCustomerCode)) <> ''
      AND EXISTS (SELECT 1 FROM PinefrostAnalytics.Transactions.DSR_Calls c WHERE c.CustomerCode = m.DMSCustomerCode)
  `);
  return result.recordset;
}

export interface TransformedEablCustomer {
  customerId: string;
  principal: string;
  outletName: string;
  channel: string | null;
  subChannel: string | null;
  territory: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
}

/** "EABL-Nyeri" / "EABL-Nyahururu" derived from Territory text, matching
 *  EablCall's own scope naming ("EABL-Nyeri & EABL-Nyahururu"). Othaya is
 *  administratively part of Nyeri (confirmed directly, not inferred from
 *  the text) — mapped explicitly rather than relying on a substring match,
 *  since "Othaya" doesn't contain "nyeri" itself. Anything else (confirmed
 *  live: a genuinely separate area, "Upper Mountain KSO" — 29 customers,
 *  unrelated to this module) gets "EABL-General" rather than being silently
 *  dropped or guessed onto the nearest named principal - same "don't guess,
 *  flag it" bucket already used for Timestamps' roster-unmapped reps. */
export function derivePrincipal(territory: string | null): string {
  const value = territory?.toLowerCase() ?? "";
  if (value.includes("nyahururu")) return "EABL-Nyahururu";
  if (value.includes("nyeri") || value.includes("othaya")) return "EABL-Nyeri";
  return "EABL-General";
}

/** Source format is "longitude,latitude" - confirmed live by range-checking
 *  real values against Kenya's actual bounds (longitude ~34-42°E, latitude
 *  ~-4.7 to +5.5°N): a sample coordinate of "36.3633646,0.039607" can only
 *  parse as (longitude, latitude) - 36.36 is out of range for a latitude,
 *  so the order is not the more common "lat,long" convention. Never assume
 *  coordinate order without checking against the actual source. */
export function parseGpsCoordinate(raw: string | null): { latitude: number | null; longitude: number | null } {
  if (!raw) return { latitude: null, longitude: null };
  const parts = raw.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return { latitude: null, longitude: null };
  const [longitude, latitude] = parts;
  return { latitude, longitude };
}

export function transformEablCustomers(rows: EablCustomerRow[]): TransformedEablCustomer[] {
  return rows.map((row) => {
    const { latitude, longitude } = parseGpsCoordinate(row.gpsCoordinate);
    return {
      customerId: row.customerId.trim(),
      principal: derivePrincipal(row.territory),
      outletName: row.outletName?.trim() || row.customerId,
      channel: row.channel?.trim() || null,
      subChannel: row.subChannel?.trim() || null,
      territory: row.territory?.trim() || null,
      latitude,
      longitude,
      status: row.status?.trim().toUpperCase() === "ACTIVE" ? "ACTIVE" : "INACTIVE",
    };
  });
}
