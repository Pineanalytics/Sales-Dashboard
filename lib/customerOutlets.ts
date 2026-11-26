// The SFA outlet behind a customer on the invoice lines, with its channel, segment, region and territory from the unified
// outlet list (OutletUniverse: Pine, Leverage, EABL DMS, Upfield DataEdge). A line is matched, in order:
//   1. by its own invoice reference (InvoiceOutlet);
//   2. else by the outlet most of the same customer's other lines point to;
//   3. else by the customer's name, only where exactly one outlet carries that name.
// Pure, no I/O: the database reads are in lib/salesLinesData.ts.
import { normalizePrincipalKey } from "./normalize";
import { OUTLET_SOURCE_LABELS, type OutletSource } from "./outletUniverse/normalize";
import { normalizeName } from "./outletUniverse/matching";

export interface OutletListRow {
  source: string;
  outletKey: string;
  principal: string;
  outletName: string;
  channel: string;
  segment: string;
  region: string;
  territory: string;
  territoryClean: string | null;
  route: string | null;
  teamLeader: string | null;
}

export const NOT_MATCHED = "Not matched";
export type OutletMatch = "Invoice reference" | "Same customer" | "Name" | typeof NOT_MATCHED;

export interface OutletAttributes {
  id: string | null;
  system: string;
  code: string;
  name: string;
  channel: string;
  segment: string;
  region: string;
  territory: string;
  route: string;
  teamLeader: string;
  match: OutletMatch;
}

export const OUTLET_COLUMNS = ["Outlet System", "Outlet Code", "Outlet Name", "Channel", "Segment", "Region", "Territory", "Route", "Outlet Team Leader", "Outlet Match"];

export function outletCells(outlet: OutletAttributes): string[] {
  return [outlet.system, outlet.code, outlet.name, outlet.channel, outlet.segment, outlet.region, outlet.territory, outlet.route, outlet.teamLeader, outlet.match];
}

export const outletId = (source: string, outletKey: string) => `${source}|${outletKey}`;

const unmatched = (): OutletAttributes => ({ id: null, system: "", code: "", name: "", channel: NOT_MATCHED, segment: NOT_MATCHED, region: NOT_MATCHED, territory: NOT_MATCHED, route: "", teamLeader: "", match: NOT_MATCHED });

/** The outlet list, looked up by id (one row per principal the outlet buys) or by name. */
export function createOutletDirectory(rows: OutletListRow[]) {
  const byId = new Map<string, OutletListRow[]>();
  const byName = new Map<string, Set<string>>();
  for (const row of rows) {
    const id = outletId(row.source, row.outletKey);
    const known = byId.get(id);
    if (known) known.push(row);
    else byId.set(id, [row]);
    const name = normalizeName(row.outletName);
    if (!name) continue;
    const ids = byName.get(name);
    if (ids) ids.add(id);
    else byName.set(name, new Set([id]));
  }

  const principalRow = (id: string, principal: string) => byId.get(id)?.find((row) => normalizePrincipalKey(row.principal) === normalizePrincipalKey(principal));

  return {
    attributes(id: string, principal: string, match: OutletMatch): OutletAttributes {
      const [source, code] = [id.slice(0, id.indexOf("|")), id.slice(id.indexOf("|") + 1)];
      const system = OUTLET_SOURCE_LABELS[source as OutletSource] ?? source;
      const own = principalRow(id, principal);
      const row = own ?? byId.get(id)?.[0];
      if (!row) return { ...unmatched(), id, system, code, match };
      // The Team Leader belongs to the principal the outlet is listed under, so it is only given for the same one.
      return { id, system, code, name: row.outletName, channel: row.channel, segment: row.segment, region: row.region, territory: row.territoryClean ?? row.territory, route: row.route ?? "", teamLeader: own?.teamLeader ?? "", match };
    },
    /** The single outlet with this name (preferring one listed under the principal), or null where none or several have it. */
    named(name: string, principal: string): string | null {
      const ids = byName.get(normalizeName(name));
      if (!ids) return null;
      if (ids.size === 1) return [...ids][0];
      const own = [...ids].filter((id) => principalRow(id, principal));
      return own.length === 1 ? own[0] : null;
    },
  };
}

export type OutletDirectory = ReturnType<typeof createOutletDirectory>;

/** Learns which outlet each customer's referenced lines point to, then answers for any line. Every line must be observed before the first answer. */
export function createOutletResolver(directory: OutletDirectory) {
  const seen = new Map<string, Map<string, number>>();
  const cache = new Map<string, string | null>();
  const usual = (customer: string): string | null => {
    let id = cache.get(customer);
    if (id === undefined) {
      id = [...(seen.get(customer) ?? [])].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      cache.set(customer, id);
    }
    return id;
  };
  return {
    observe(customer: string, directId: string | null) {
      if (!directId) return;
      let ids = seen.get(customer);
      if (!ids) seen.set(customer, (ids = new Map()));
      ids.set(directId, (ids.get(directId) ?? 0) + 1);
    },
    /** The outlet of one line. */
    line(customer: string, principal: string, directId: string | null): OutletAttributes {
      if (directId) return directory.attributes(directId, principal, "Invoice reference");
      const shared = usual(customer);
      if (shared) return directory.attributes(shared, principal, "Same customer");
      const named = directory.named(customer, principal);
      return named ? directory.attributes(named, principal, "Name") : unmatched();
    },
    /** The outlet that stands for a customer: its usual referenced outlet, else the one with its name. */
    customer(customer: string, principal: string): OutletAttributes {
      const own = usual(customer);
      if (own) return directory.attributes(own, principal, "Invoice reference");
      const named = directory.named(customer, principal);
      return named ? directory.attributes(named, principal, "Name") : unmatched();
    },
    /** How many different outlets the customer's referenced lines point to. */
    outletCount: (customer: string) => seen.get(customer)?.size ?? 0,
  };
}

export type OutletResolver = ReturnType<typeof createOutletResolver>;
