/**
 * One-off real customer-master import for the coaching tenant. Handles two
 * real-world data issues found in the actual export: (1) latitude/longitude
 * combined into a single quoted "lat,lng" field instead of split across the
 * two columns, and (2) auto-creating any territory/distributor/route/channel
 * referenced by name that doesn't exist yet — this file has ~800 unique
 * routes and only 5 territories, so pre-creating them by hand isn't
 * practical.
 *
 * Run with: npx tsx scripts/import-real-outlets.ts <path-to-outlets.csv>
 */
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";
import fs from "fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const COACHING_FORM_ID = "de8bc27c-c074-4220-a34c-6b07db02a61e";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-real-outlets.ts <path-to-outlets.csv>");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Handles both "lat,lng" combined in the latitude column (found in ~94% of
// real rows) and properly split latitude/longitude columns.
function parseLatLng(latRaw: string, lngRaw: string): [number | null, number | null] {
  if (latRaw && latRaw.includes(",")) {
    const [latPart, lngPart] = latRaw.split(",").map((s) => s.trim());
    const lat = Number(latPart);
    const lng = Number(lngPart);
    return [Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null];
  }
  const lat = latRaw ? Number(latRaw) : NaN;
  const lng = lngRaw ? Number(lngRaw) : NaN;
  return [Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null];
}

async function main() {
  const content = fs.readFileSync(csvPath, "utf8");
  const { data: rows } = Papa.parse(content, { header: true, skipEmptyLines: true }) as {
    data: Record<string, string>[];
  };
  console.log(`Parsed ${rows.length} rows.`);

  const { data: existingOrgUnits } = await admin
    .from("coaching_org_units")
    .select("id, name, unit_type")
    .eq("form_id", COACHING_FORM_ID);
  const territoryByName = new Map(
    (existingOrgUnits ?? []).filter((u) => u.unit_type === "territory").map((u) => [u.name.toLowerCase(), u.id])
  );
  const distributorByName = new Map(
    (existingOrgUnits ?? []).filter((u) => u.unit_type === "distributor").map((u) => [u.name.toLowerCase(), u.id])
  );

  const { data: existingRoutes } = await admin
    .from("coaching_routes")
    .select("id, name")
    .eq("form_id", COACHING_FORM_ID);
  const routeByName = new Map((existingRoutes ?? []).map((r) => [r.name.toLowerCase(), r.id]));

  const { data: existingChannels } = await admin
    .from("coaching_channels")
    .select("id, name, parent_id")
    .eq("form_id", COACHING_FORM_ID);
  const channelByName = new Map((existingChannels ?? []).map((c) => [c.name.toLowerCase(), c.id]));

  const { data: profiles } = await admin.from("profiles").select("id, email");
  const profileByEmail = new Map((profiles ?? []).map((p) => [p.email.toLowerCase(), p.id]));

  async function getOrCreateTerritory(name: string): Promise<string | null> {
    if (!name) return null;
    const key = name.toLowerCase();
    if (territoryByName.has(key)) return territoryByName.get(key)!;
    const { data, error } = await admin
      .from("coaching_org_units")
      .insert({ form_id: COACHING_FORM_ID, unit_type: "territory", name })
      .select("id")
      .single();
    if (error) throw error;
    territoryByName.set(key, data.id);
    console.log(`Created territory: ${name}`);
    return data.id;
  }
  async function getOrCreateDistributor(name: string, territoryId: string | null): Promise<string | null> {
    if (!name) return null;
    const key = name.toLowerCase();
    if (distributorByName.has(key)) return distributorByName.get(key)!;
    const { data, error } = await admin
      .from("coaching_org_units")
      .insert({ form_id: COACHING_FORM_ID, unit_type: "distributor", name, parent_id: territoryId })
      .select("id")
      .single();
    if (error) throw error;
    distributorByName.set(key, data.id);
    console.log(`Created distributor: ${name}`);
    return data.id;
  }
  async function getOrCreateRoute(name: string, territoryId: string | null): Promise<string | null> {
    if (!name) return null;
    const key = name.toLowerCase();
    if (routeByName.has(key)) return routeByName.get(key)!;
    const { data, error } = await admin
      .from("coaching_routes")
      .insert({ form_id: COACHING_FORM_ID, name, territory_id: territoryId })
      .select("id")
      .single();
    if (error) throw error;
    routeByName.set(key, data.id);
    console.log(`Created route: ${name}`);
    return data.id;
  }
  async function getOrCreateChannel(raw: string): Promise<string | null> {
    if (!raw) return null;
    const parts = raw
      .split(/[>/]/)
      .map((p) => p.trim())
      .filter(Boolean);
    let parentId: string | null = null;
    for (const part of parts) {
      const key = part.toLowerCase();
      if (channelByName.has(key)) {
        parentId = channelByName.get(key)!;
        continue;
      }
      const { data, error } = await admin
        .from("coaching_channels")
        .insert({ form_id: COACHING_FORM_ID, name: part, parent_id: parentId })
        .select("id")
        .single();
      if (error) throw error;
      channelByName.set(key, data.id);
      console.log(`Created channel: ${part}`);
      parentId = data.id;
    }
    return parentId;
  }

  // Pre-resolve/create every unique reference value first (cheap: 5
  // territories, 1 distributor, ~800 routes, ~10 channels) so the main loop
  // below is a pure in-memory lookup, not a network round-trip per row.
  const uniqueTerritories = new Set(rows.map((r) => (r.territory_name ?? "").trim()).filter(Boolean));
  for (const name of uniqueTerritories) await getOrCreateTerritory(name);

  for (const r of rows) {
    const territoryId = territoryByName.get((r.territory_name ?? "").trim().toLowerCase()) ?? null;
    const distName = (r.distributor_name ?? "").trim();
    if (distName && !distributorByName.has(distName.toLowerCase())) {
      await getOrCreateDistributor(distName, territoryId);
    }
  }
  const seenRoutes = new Set<string>();
  for (const r of rows) {
    const routeName = (r.route_name ?? "").trim();
    const key = routeName.toLowerCase();
    if (routeName && !routeByName.has(key) && !seenRoutes.has(key)) {
      seenRoutes.add(key);
      const territoryId = territoryByName.get((r.territory_name ?? "").trim().toLowerCase()) ?? null;
      await getOrCreateRoute(routeName, territoryId);
    }
  }
  const seenChannels = new Set<string>();
  for (const r of rows) {
    const channelRaw = (r.channel_name ?? "").trim();
    if (channelRaw && !seenChannels.has(channelRaw.toLowerCase())) {
      seenChannels.add(channelRaw.toLowerCase());
      await getOrCreateChannel(channelRaw);
    }
  }

  console.log("Master data resolved. Building outlet rows...");

  const outletRows = rows
    .filter((r) => r.outlet_code && r.name)
    .map((r) => {
      const [latitude, longitude] = parseLatLng((r.latitude ?? "").trim(), (r.longitude ?? "").trim());
      return {
        form_id: COACHING_FORM_ID,
        outlet_code: r.outlet_code,
        name: r.name,
        trading_name: r.trading_name || null,
        contact_person: r.contact_person || null,
        phone: r.phone || null,
        address: r.address || null,
        channel_id: getOrCreateChannelSync(r.channel_name),
        route_id: routeByName.get((r.route_name ?? "").trim().toLowerCase()) ?? null,
        territory_id: territoryByName.get((r.territory_name ?? "").trim().toLowerCase()) ?? null,
        distributor_id: distributorByName.get((r.distributor_name ?? "").trim().toLowerCase()) ?? null,
        assigned_sales_rep_id: profileByEmail.get((r.assigned_sales_rep_email ?? "").trim().toLowerCase()) ?? null,
        assigned_team_leader_id:
          profileByEmail.get((r.assigned_team_leader_email ?? "").trim().toLowerCase()) ?? null,
        latitude,
        longitude,
        geofence_radius_m: r.geofence_radius_m ? Number(r.geofence_radius_m) : 100,
      };
    });

  function getOrCreateChannelSync(raw: string | undefined): string | null {
    if (!raw) return null;
    const parts = raw
      .split(/[>/]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;
    // Resolve to the deepest (last) part's id — all parts were already
    // created in the pre-resolve pass above.
    return channelByName.get(parts[parts.length - 1].toLowerCase()) ?? null;
  }

  console.log(`Inserting ${outletRows.length} outlets in batches...`);
  const BATCH = 500;
  let inserted = 0;
  const errors: string[] = [];
  for (let i = 0; i < outletRows.length; i += BATCH) {
    const batch = outletRows.slice(i, i + BATCH);
    const { error } = await admin.from("coaching_outlets").insert(batch);
    if (error) {
      errors.push(`batch starting at ${i}: ${error.message}`);
      console.error(`Error in batch at ${i}:`, error.message);
    } else {
      inserted += batch.length;
    }
    if (i % 5000 === 0) console.log(`... ${i}/${outletRows.length}`);
  }

  console.log("\n=== Summary ===");
  console.log("Total rows in CSV:", rows.length);
  console.log("Outlets inserted:", inserted);
  console.log("Batch errors:", errors);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
