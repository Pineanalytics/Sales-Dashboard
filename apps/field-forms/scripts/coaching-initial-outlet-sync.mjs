import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1_000;
const WRITE_BATCH_SIZE = 250;
const formId = process.env.COACHING_SYNC_FORM_ID;
const runId = process.env.COACHING_SYNC_RUN_ID;
const analyticsBaseUrl = process.env.ANALYTICS_REFERENCE_URL?.replace(/\/$/, "");
const bridgeKey = process.env.COACHING_REFERENCE_SYNC_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!formId || !runId || !analyticsBaseUrl || !bridgeKey || !supabaseUrl || !serviceRoleKey) {
  throw new Error("The initial coaching outlet sync is missing required server configuration.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalized = (value) => value?.trim().toLocaleLowerCase() ?? "";
const sourceCode = (outlet) => `PINE:${outlet.principal}:${outlet.customerId}`;
const archivedCode = (id) => `ARCHIVED-PINE-DUPLICATE:${id}`;

async function updateRun(values) {
  const { error } = await admin
    .from("coaching_reference_sync_runs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (error) throw new Error(`Could not update outlet-sync status: ${error.message}`);
}

async function fetchAnalyticsOutlets() {
  const outlets = [];
  let cursor = null;
  do {
    const url = new URL(`${analyticsBaseUrl}/api/integrations/coaching/reference`);
    url.searchParams.set("resource", "outlets");
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);
    const response = await fetch(url, { headers: { "x-coaching-reference-key": bridgeKey }, cache: "no-store" });
    if (!response.ok) throw new Error(`Analytics outlet feed returned ${response.status}.`);
    const payload = await response.json();
    outlets.push(...(payload.outlets ?? []));
    cursor = payload.nextCursor ?? null;
  } while (cursor);
  return outlets.filter((outlet) => outlet.customerId?.trim());
}

async function fetchAll(table, select) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from(table)
      .select(select)
      .eq("form_id", formId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function ensureReferenceValues(outlets) {
  const [principals, channels, reps] = await Promise.all([
    fetchAll("coaching_principals", "id, name"),
    fetchAll("coaching_channels", "id, name"),
    fetchAll("coaching_sales_reps", "id, full_name, team_leader_id, is_active"),
  ]);
  const principalByName = new Map(principals.map((row) => [normalized(row.name), row.id]));
  const channelByName = new Map(channels.map((row) => [normalized(row.name), row.id]));
  const repByName = new Map(reps.filter((row) => row.is_active).map((row) => [normalized(row.full_name), row]));
  const missingPrincipals = [...new Set(outlets.map((row) => row.principal?.trim()).filter((name) => name && !principalByName.has(normalized(name))))];
  const missingChannels = [...new Set(outlets.map((row) => row.channel?.trim()).filter((name) => name && !channelByName.has(normalized(name))))];
  if (missingPrincipals.length) {
    const { data, error } = await admin.from("coaching_principals")
      .insert(missingPrincipals.map((name) => ({ form_id: formId, name }))).select("id, name");
    if (error) throw new Error(`Could not create Analytics principals: ${error.message}`);
    for (const row of data ?? []) principalByName.set(normalized(row.name), row.id);
  }
  if (missingChannels.length) {
    const { data, error } = await admin.from("coaching_channels")
      .insert(missingChannels.map((name) => ({ form_id: formId, name }))).select("id, name");
    if (error) throw new Error(`Could not create Analytics channels: ${error.message}`);
    for (const row of data ?? []) channelByName.set(normalized(row.name), row.id);
  }
  return { principalByName, channelByName, repByName };
}

async function writeInBatches(rows, operation) {
  for (let index = 0; index < rows.length; index += WRITE_BATCH_SIZE) await operation(rows.slice(index, index + WRITE_BATCH_SIZE));
}

async function main() {
  const stats = {
    sourceRows: 0, linkedExisting: 0, sourceRowsUpdated: 0, created: 0,
    archivedDuplicates: 0, assignmentMatched: 0, ambiguousPrincipalRelationships: 0,
  };
  await updateRun({ status: "running", started_at: new Date().toISOString(), message: "Reading the current Analytics outlet estate.", stats });
  const outlets = await fetchAnalyticsOutlets();
  stats.sourceRows = outlets.length;
  await updateRun({ message: `Reconciling ${outlets.length.toLocaleString()} active Analytics outlet relationships.`, stats });
  const [existingOutlets, references] = await Promise.all([
    fetchAll("coaching_outlets", "id, outlet_code, is_active"),
    ensureReferenceValues(outlets),
  ]);
  const sourceCountByCustomerId = new Map();
  for (const outlet of outlets) {
    const customerId = outlet.customerId.trim();
    sourceCountByCustomerId.set(customerId, (sourceCountByCustomerId.get(customerId) ?? 0) + 1);
  }
  const existingByCode = new Map(existingOutlets.map((row) => [row.outlet_code, row]));
  const activeLegacyByCustomerId = new Map(existingOutlets
    .filter((row) => row.is_active && row.outlet_code && !row.outlet_code.startsWith("PINE:") && !row.outlet_code.startsWith("ARCHIVED-PINE-DUPLICATE:"))
    .map((row) => [row.outlet_code, row]));
  const archiveRows = [];
  const updateRows = [];
  const createRows = [];
  const exceptionRows = [];

  for (const outlet of outlets) {
    const customerId = outlet.customerId.trim();
    const canonicalCode = sourceCode(outlet);
    const sourceRow = existingByCode.get(canonicalCode);
    const legacyRow = activeLegacyByCustomerId.get(customerId);
    const isAmbiguousCustomer = (sourceCountByCustomerId.get(customerId) ?? 0) > 1;
    let target = sourceRow;
    if (!sourceRow && legacyRow && isAmbiguousCustomer) {
      stats.ambiguousPrincipalRelationships++;
      exceptionRows.push({ form_id: formId, source_key: canonicalCode, customer_id: customerId, principal: outlet.principal, reason: "customer_id_shared_across_principals", status: "open" });
      continue;
    }
    if (sourceRow && legacyRow && sourceRow.id !== legacyRow.id && !isAmbiguousCustomer) {
      archiveRows.push({ id: sourceRow.id, form_id: formId, outlet_code: archivedCode(sourceRow.id), is_active: false });
      target = legacyRow;
      stats.archivedDuplicates++;
    } else if (!target && legacyRow) {
      target = legacyRow;
    }
    const rep = references.repByName.get(normalized(outlet.mostRecentRep));
    const values = {
      outlet_code: canonicalCode,
      name: outlet.outletName?.trim() || customerId,
      principal_id: references.principalByName.get(normalized(outlet.principal)) ?? null,
      channel_id: references.channelByName.get(normalized(outlet.channel)) ?? null,
      assigned_sales_rep_id: rep?.id ?? null,
      assigned_team_leader_id: rep?.team_leader_id ?? null,
      is_active: true,
    };
    if (rep) stats.assignmentMatched++;
    if (target) {
      updateRows.push({ id: target.id, form_id: formId, ...values });
      if (target.id === legacyRow?.id) stats.linkedExisting++;
      else stats.sourceRowsUpdated++;
    } else {
      createRows.push({ form_id: formId, geofence_radius_m: 100, ...values });
      stats.created++;
    }
  }

  await updateRun({ message: "Applying safe outlet links in background batches.", stats });
  await writeInBatches(archiveRows, async (batch) => {
    const { error } = await admin.from("coaching_outlets").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`Could not archive preliminary duplicates: ${error.message}`);
  });
  await writeInBatches(updateRows, async (batch) => {
    const { error } = await admin.from("coaching_outlets").upsert(batch, { onConflict: "id" });
    if (error) throw new Error(`Could not update linked outlets: ${error.message}`);
  });
  await writeInBatches(createRows, async (batch) => {
    const { error } = await admin.from("coaching_outlets").insert(batch);
    if (error) throw new Error(`Could not add missing Analytics outlets: ${error.message}`);
  });
  await writeInBatches(exceptionRows, async (batch) => {
    const { error } = await admin.from("coaching_reference_sync_exceptions").upsert(batch, { onConflict: "form_id,source_key" });
    if (error) throw new Error(`Could not record principal-mapping exceptions: ${error.message}`);
  });
  await updateRun({ status: "completed", completed_at: new Date().toISOString(), message: "Initial outlet reconciliation completed.", stats });
}

main().catch(async (error) => {
  console.error("Initial coaching outlet sync failed", error);
  try {
    await updateRun({ status: "failed", completed_at: new Date().toISOString(), message: error instanceof Error ? error.message : "Initial outlet reconciliation failed." });
  } catch (statusError) {
    console.error("Could not record outlet sync failure", statusError);
  }
  process.exitCode = 1;
});
