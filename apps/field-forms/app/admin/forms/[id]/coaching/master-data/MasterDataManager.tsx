"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Papa from "papaparse";
import { parseXlsxFile, downloadXlsxTemplate } from "@/lib/xlsxImport";
import CoachingReferenceSync from "@/components/CoachingReferenceSync";
import type {
  CoachingOrgUnit,
  CoachingChannel,
  CoachingRoute,
  CoachingOutlet,
  CoachingPrincipal,
} from "@/lib/coachingTypes";

interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string;
  field_role: string | null;
  manager_id: string | null;
}

interface SalesRepRow {
  id: string;
  full_name: string;
  email: string | null;
  team_leader_id: string;
}

interface TeamLeaderPrincipalRow {
  team_leader_id: string;
  principal_id: string;
}

type Tab = "org" | "channels" | "routes" | "outlets" | "roster" | "principals";

// Shared "Upload Excel" control — parses the file into the same
// Record<string,string>[] shape Papa.parse produces for CSV, so every
// entity's existing lookup/insert logic works unchanged regardless of
// which format the admin uploads.
function ExcelUpload({
  onRows,
  busy,
}: {
  onRows: (rows: Record<string, string>[]) => void;
  busy: boolean;
}) {
  return (
    <label className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-2 hover:border-[var(--pine-500)] cursor-pointer">
      {busy ? "Importing..." : "Upload Excel (.xlsx)"}
      <input
        type="file"
        accept=".xlsx"
        className="hidden"
        disabled={busy}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          const rows = await parseXlsxFile(file);
          onRows(rows);
        }}
      />
    </label>
  );
}

function TemplateDownloadButton({
  filename,
  columns,
  example,
  note,
}: {
  filename: string;
  columns: string[];
  example: string[][];
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => downloadXlsxTemplate(filename, columns, example, note)}
      className="text-xs text-[var(--pine-700)] hover:underline"
    >
      Download sample template
    </button>
  );
}

export default function MasterDataManager({
  formId,
  initialOrgUnits,
  initialChannels,
  initialRoutes,
  initialOutlets,
  initialProfiles,
  initialSalesReps,
  initialPrincipals,
  initialTeamLeaderPrincipals,
}: {
  formId: string;
  initialOrgUnits: CoachingOrgUnit[];
  initialChannels: CoachingChannel[];
  initialRoutes: CoachingRoute[];
  initialOutlets: CoachingOutlet[];
  initialProfiles: ProfileRow[];
  initialSalesReps: SalesRepRow[];
  initialPrincipals: CoachingPrincipal[];
  initialTeamLeaderPrincipals: TeamLeaderPrincipalRow[];
}) {
  const [tab, setTab] = useState<Tab>("org");
  const tabs: { key: Tab; label: string }[] = [
    { key: "org", label: `Regions/Territories (${initialOrgUnits.length})` },
    { key: "channels", label: `Channels (${initialChannels.length})` },
    { key: "routes", label: `Routes (${initialRoutes.length})` },
    { key: "outlets", label: `Outlets (${initialOutlets.length})` },
    { key: "roster", label: `Roster (${initialProfiles.length})` },
    { key: "principals", label: `Principals (${initialPrincipals.length})` },
  ];

  return (
    <div>
      <CoachingReferenceSync formId={formId} />
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm border ${
              tab === t.key
                ? "bg-[var(--pine-700)] text-white border-[var(--pine-700)]"
                : "border-[var(--line)] text-[var(--ink-600)] hover:border-[var(--pine-500)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "org" && <OrgUnitsPanel formId={formId} initial={initialOrgUnits} />}
      {tab === "channels" && <ChannelsPanel formId={formId} initial={initialChannels} />}
      {tab === "routes" && (
        <RoutesPanel formId={formId} initial={initialRoutes} orgUnits={initialOrgUnits} />
      )}
      {tab === "outlets" && (
        <OutletsPanel
          formId={formId}
          initial={initialOutlets}
          channels={initialChannels}
          routes={initialRoutes}
          orgUnits={initialOrgUnits}
          profiles={initialProfiles}
          reps={initialSalesReps}
          principals={initialPrincipals}
        />
      )}
      {tab === "roster" && (
        <RosterPanel
          formId={formId}
          initial={initialProfiles}
          principals={initialPrincipals}
          teamLeaderPrincipals={initialTeamLeaderPrincipals}
        />
      )}
      {tab === "principals" && (
        <PrincipalsPanel
          formId={formId}
          initial={initialPrincipals}
          profiles={initialProfiles}
          teamLeaderPrincipals={initialTeamLeaderPrincipals}
        />
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="bg-white border border-[var(--line)] rounded-lg p-5">{children}</div>;
}

const inputCls = "rounded-md border border-[var(--line)] px-2 py-1.5 text-sm";
const btnCls =
  "rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-50";
const linkBtnCls = "text-xs text-[var(--pine-700)] hover:underline";
const dangerLinkCls = "text-xs text-[var(--rust-600)] hover:underline";

function OrgUnitsPanel({ formId, initial }: { formId: string; initial: CoachingOrgUnit[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [unitType, setUnitType] = useState<"region" | "territory" | "distributor">("region");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const regions = initial.filter((u) => u.unit_type === "region");
  const territories = initial.filter((u) => u.unit_type === "territory");
  const distributors = initial.filter((u) => u.unit_type === "distributor");
  const parentOptions = unitType === "territory" ? regions : unitType === "distributor" ? territories : [];

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    await supabase.from("coaching_org_units").insert({
      form_id: formId,
      unit_type: unitType,
      name: name.trim(),
      parent_id: parentId || null,
    });
    setBusy(false);
    setName("");
    router.refresh();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await supabase.from("coaching_org_units").update({ name: editName.trim() }).eq("id", id);
    setEditingId(null);
    router.refresh();
  }

  async function toggleActive(u: CoachingOrgUnit) {
    await supabase.from("coaching_org_units").update({ is_active: !u.is_active }).eq("id", u.id);
    router.refresh();
  }

  async function handleImportRows(rows: Record<string, string>[]) {
    // Upsert by (unit_type, name) — re-uploading the same sheet after
    // editing a row elsewhere shouldn't create a duplicate, it should just
    // reactivate/leave the existing row alone.
    const existingKey = new Map(
      initial.map((u) => [`${u.unit_type}|${u.name.toLowerCase()}`, u.id])
    );
    let updated = 0;
    let created = 0;
    let errorMsg: string | null = null;
    for (const r of rows) {
      if (!r.name || !r.unit_type) continue;
      const unitType = r.unit_type.toLowerCase();
      const key = `${unitType}|${r.name.toLowerCase()}`;
      const existingId = existingKey.get(key);
      if (existingId) {
        const { error } = await supabase
          .from("coaching_org_units")
          .update({ is_active: true })
          .eq("id", existingId);
        if (error) errorMsg = error.message;
        else updated++;
      } else {
        const { error } = await supabase
          .from("coaching_org_units")
          .insert({ form_id: formId, unit_type: unitType, name: r.name, parent_id: null });
        if (error) errorMsg = error.message;
        else created++;
      }
    }
    setImportResult(
      errorMsg ? `Error: ${errorMsg}` : `${created} created, ${updated} matched existing rows (left alone).`
    );
    router.refresh();
  }

  function column(u: CoachingOrgUnit, list: CoachingOrgUnit[]) {
    return (
      <li key={u.id} className={`flex items-center justify-between gap-2 ${!u.is_active ? "opacity-50" : ""}`}>
        {editingId === u.id ? (
          <div className="flex gap-1 flex-1">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className={`${inputCls} flex-1`}
              autoFocus
            />
            <button onClick={() => saveEdit(u.id)} className={linkBtnCls}>
              Save
            </button>
            <button onClick={() => setEditingId(null)} className="text-xs text-[var(--ink-400)]">
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span>{u.name}</span>
            <span className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  setEditingId(u.id);
                  setEditName(u.name);
                }}
                className={linkBtnCls}
              >
                Edit
              </button>
              <button onClick={() => toggleActive(u)} className={u.is_active ? dangerLinkCls : linkBtnCls}>
                {u.is_active ? "Deactivate" : "Reactivate"}
              </button>
            </span>
          </>
        )}
      </li>
    );
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={unitType}
          onChange={(e) => {
            setUnitType(e.target.value as typeof unitType);
            setParentId("");
          }}
          className={inputCls}
        >
          <option value="region">Region</option>
          <option value="territory">Territory</option>
          <option value="distributor">Distributor</option>
        </select>
        {unitType !== "region" && (
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
            <option value="">
              {unitType === "territory" ? "Parent region..." : "Parent territory..."}
            </option>
            {parentOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className={`flex-1 min-w-[160px] ${inputCls}`}
        />
        <button disabled={busy} onClick={add} className={btnCls}>
          + Add
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <ExcelUpload onRows={handleImportRows} busy={busy} />
        <TemplateDownloadButton
          filename="org_units_template"
          columns={["unit_type", "name"]}
          example={[
            ["region", "Nairobi Region"],
            ["territory", "Nairobi Central"],
            ["distributor", "ABC Distributors Ltd"],
          ]}
          note="unit_type must be one of: region, territory, distributor. Upload regions first, then territories/distributors — parent linking for bulk-uploaded rows is done later via Edit."
        />
      </div>
      {importResult && <p className="mb-4 text-sm text-[var(--pine-700)]">{importResult}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="font-medium text-[var(--ink-900)] mb-2">Regions ({regions.length})</p>
          <ul className="space-y-1 text-[var(--ink-600)]">{regions.map((r) => column(r, regions))}</ul>
        </div>
        <div>
          <p className="font-medium text-[var(--ink-900)] mb-2">Territories ({territories.length})</p>
          <ul className="space-y-1 text-[var(--ink-600)]">{territories.map((t) => column(t, territories))}</ul>
        </div>
        <div>
          <p className="font-medium text-[var(--ink-900)] mb-2">Distributors ({distributors.length})</p>
          <ul className="space-y-1 text-[var(--ink-600)]">{distributors.map((d) => column(d, distributors))}</ul>
        </div>
      </div>
    </Panel>
  );
}

function ChannelsPanel({ formId, initial }: { formId: string; initial: CoachingChannel[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const topLevel = initial.filter((c) => !c.parent_id);
  const subsOf = (parentId: string) => initial.filter((c) => c.parent_id === parentId);

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    await supabase
      .from("coaching_channels")
      .insert({ form_id: formId, name: name.trim(), parent_id: parentId || null });
    setBusy(false);
    setName("");
    router.refresh();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await supabase.from("coaching_channels").update({ name: editName.trim() }).eq("id", id);
    setEditingId(null);
    router.refresh();
  }

  async function toggleActive(c: CoachingChannel) {
    await supabase.from("coaching_channels").update({ is_active: !c.is_active }).eq("id", c.id);
    router.refresh();
  }

  async function handleImportRows(rows: Record<string, string>[]) {
    // Upsert by name — leaves an already-existing channel (and any
    // sub-channel nesting set up via Edit) untouched instead of duplicating it.
    const existingKey = new Map(initial.map((c) => [c.name.toLowerCase(), c.id]));
    let updated = 0;
    let created = 0;
    let errorMsg: string | null = null;
    for (const r of rows) {
      if (!r.name) continue;
      const key = r.name.toLowerCase();
      const existingId = existingKey.get(key);
      if (existingId) {
        const { error } = await supabase.from("coaching_channels").update({ is_active: true }).eq("id", existingId);
        if (error) errorMsg = error.message;
        else updated++;
      } else {
        const { error } = await supabase
          .from("coaching_channels")
          .insert({ form_id: formId, name: r.name, parent_id: null });
        if (error) errorMsg = error.message;
        else created++;
      }
    }
    setImportResult(
      errorMsg ? `Error: ${errorMsg}` : `${created} created, ${updated} matched existing rows (left alone).`
    );
    router.refresh();
  }

  function row(c: CoachingChannel) {
    return (
      <li key={c.id} className={`flex items-center justify-between gap-2 ${!c.is_active ? "opacity-50" : ""}`}>
        {editingId === c.id ? (
          <div className="flex gap-1 flex-1">
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className={`${inputCls} flex-1`}
              autoFocus
            />
            <button onClick={() => saveEdit(c.id)} className={linkBtnCls}>
              Save
            </button>
            <button onClick={() => setEditingId(null)} className="text-xs text-[var(--ink-400)]">
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className={c.parent_id ? "" : "font-medium text-[var(--ink-900)]"}>{c.name}</span>
            <span className="flex gap-2 shrink-0">
              <button
                onClick={() => {
                  setEditingId(c.id);
                  setEditName(c.name);
                }}
                className={linkBtnCls}
              >
                Edit
              </button>
              <button onClick={() => toggleActive(c)} className={c.is_active ? dangerLinkCls : linkBtnCls}>
                {c.is_active ? "Deactivate" : "Reactivate"}
              </button>
            </span>
          </>
        )}
      </li>
    );
  }

  return (
    <Panel>
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className={inputCls}>
          <option value="">Top-level channel</option>
          {topLevel.map((c) => (
            <option key={c.id} value={c.id}>
              Sub-channel of {c.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Channel name"
          className={`flex-1 min-w-[160px] ${inputCls}`}
        />
        <button disabled={busy} onClick={add} className={btnCls}>
          + Add
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <ExcelUpload onRows={handleImportRows} busy={busy} />
        <TemplateDownloadButton
          filename="channels_template"
          columns={["name"]}
          example={[["Traditional Trade"], ["Modern Trade"]]}
          note="Bulk-uploaded channels land as top-level; use Edit to nest one under another as a sub-channel."
        />
      </div>
      {importResult && <p className="mb-4 text-sm text-[var(--pine-700)]">{importResult}</p>}

      <ul className="space-y-2 text-sm">
        {topLevel.map((c) => (
          <li key={c.id}>
            {row(c)}
            <ul className="ml-5 mt-1 space-y-1 text-[var(--ink-600)]">{subsOf(c.id).map((s) => row(s))}</ul>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RoutesPanel({
  formId,
  initial,
  orgUnits,
}: {
  formId: string;
  initial: CoachingRoute[];
  orgUnits: CoachingOrgUnit[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [territoryId, setTerritoryId] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTerritoryId, setEditTerritoryId] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);
  const territories = orgUnits.filter((u) => u.unit_type === "territory");
  const territoryName = (id: string | null) => territories.find((t) => t.id === id)?.name ?? "—";

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    await supabase
      .from("coaching_routes")
      .insert({ form_id: formId, name: name.trim(), territory_id: territoryId || null });
    setBusy(false);
    setName("");
    router.refresh();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await supabase
      .from("coaching_routes")
      .update({ name: editName.trim(), territory_id: editTerritoryId || null })
      .eq("id", id);
    setEditingId(null);
    router.refresh();
  }

  async function toggleActive(r: CoachingRoute) {
    await supabase.from("coaching_routes").update({ is_active: !r.is_active }).eq("id", r.id);
    router.refresh();
  }

  async function handleImportRows(rows: Record<string, string>[]) {
    const territoryByName = new Map(territories.map((t) => [t.name.toLowerCase(), t.id]));
    // Upsert by (name, territory) — updates the territory link on an
    // existing route instead of creating a duplicate route with the same name.
    const existingKey = new Map(
      initial.map((r) => [`${r.name.toLowerCase()}|${r.territory_id ?? ""}`, r.id])
    );
    let updated = 0;
    let created = 0;
    let errorMsg: string | null = null;
    for (const r of rows) {
      if (!r.name) continue;
      const territoryId = territoryByName.get((r.territory_name ?? "").toLowerCase()) ?? null;
      const key = `${r.name.toLowerCase()}|${territoryId ?? ""}`;
      const existingId = existingKey.get(key) ?? existingKey.get(`${r.name.toLowerCase()}|`);
      if (existingId) {
        const { error } = await supabase
          .from("coaching_routes")
          .update({ territory_id: territoryId, is_active: true })
          .eq("id", existingId);
        if (error) errorMsg = error.message;
        else updated++;
      } else {
        const { error } = await supabase
          .from("coaching_routes")
          .insert({ form_id: formId, name: r.name, territory_id: territoryId });
        if (error) errorMsg = error.message;
        else created++;
      }
    }
    setImportResult(
      errorMsg ? `Error: ${errorMsg}` : `${created} created, ${updated} updated existing rows.`
    );
    router.refresh();
  }

  return (
    <Panel>
      <div className="flex flex-wrap gap-2 mb-3">
        <select value={territoryId} onChange={(e) => setTerritoryId(e.target.value)} className={inputCls}>
          <option value="">Territory...</option>
          {territories.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Route name"
          className={`flex-1 min-w-[160px] ${inputCls}`}
        />
        <button disabled={busy} onClick={add} className={btnCls}>
          + Add
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <ExcelUpload onRows={handleImportRows} busy={busy} />
        <TemplateDownloadButton
          filename="routes_template"
          columns={["name", "territory_name"]}
          example={[["Route 1", "Nairobi Central"]]}
          note="territory_name must match an existing Territory exactly (case-insensitive)."
        />
      </div>
      {importResult && <p className="mb-4 text-sm text-[var(--pine-700)]">{importResult}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--ink-400)] border-b border-[var(--line)]">
            <th className="py-1.5">Route</th>
            <th className="py-1.5">Territory</th>
            <th className="py-1.5"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <tr key={r.id} className={`border-b border-[var(--line)] ${!r.is_active ? "opacity-50" : ""}`}>
              {editingId === r.id ? (
                <>
                  <td className="py-1.5 pr-2">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={inputCls}
                      autoFocus
                    />
                  </td>
                  <td className="py-1.5 pr-2">
                    <select
                      value={editTerritoryId}
                      onChange={(e) => setEditTerritoryId(e.target.value)}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {territories.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 flex gap-2">
                    <button onClick={() => saveEdit(r.id)} className={linkBtnCls}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-[var(--ink-400)]">
                      Cancel
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5 text-[var(--ink-600)]">{territoryName(r.territory_id)}</td>
                  <td className="py-1.5 flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(r.id);
                        setEditName(r.name);
                        setEditTerritoryId(r.territory_id ?? "");
                      }}
                      className={linkBtnCls}
                    >
                      Edit
                    </button>
                    <button onClick={() => toggleActive(r)} className={r.is_active ? dangerLinkCls : linkBtnCls}>
                      {r.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function OutletsPanel({
  formId,
  initial,
  channels,
  routes,
  orgUnits,
  profiles,
  reps,
  principals,
}: {
  formId: string;
  initial: CoachingOutlet[];
  channels: CoachingChannel[];
  routes: CoachingRoute[];
  orgUnits: CoachingOrgUnit[];
  profiles: ProfileRow[];
  reps: SalesRepRow[];
  principals: CoachingPrincipal[];
}) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Partial<CoachingOutlet>>({});

  const nameOf = (list: { id: string; name: string }[], id: string | null) =>
    list.find((x) => x.id === id)?.name ?? "—";
  const emailOf = (id: string | null) => profiles.find((p) => p.id === id)?.email ?? "—";
  const repNameOf = (id: string | null) => reps.find((r) => r.id === id)?.full_name ?? "—";

  async function saveEdit(id: string) {
    const supabase = createClient();
    await supabase
      .from("coaching_outlets")
      .update({
        name: editRow.name,
        trading_name: editRow.trading_name || null,
        contact_person: editRow.contact_person || null,
        phone: editRow.phone || null,
        address: editRow.address || null,
        route_id: editRow.route_id || null,
        channel_id: editRow.channel_id || null,
        assigned_sales_rep_id: editRow.assigned_sales_rep_id || null,
        assigned_team_leader_id: editRow.assigned_team_leader_id || null,
        principal_id: editRow.principal_id || null,
        geofence_radius_m: editRow.geofence_radius_m,
      })
      .eq("id", id);
    setEditingId(null);
    router.refresh();
  }

  async function toggleActive(o: CoachingOutlet) {
    const supabase = createClient();
    await supabase.from("coaching_outlets").update({ is_active: !o.is_active }).eq("id", o.id);
    router.refresh();
  }

  function startImport(rows: Record<string, string>[]) {
    setImporting(true);
    runImport(rows);
  }

  async function runImport(rows: Record<string, string>[]) {
    const supabase = createClient();
    const profileByEmail = new Map(profiles.map((p) => [p.email.toLowerCase(), p.id]));
    const repByEmail = new Map(reps.filter((r) => r.email).map((r) => [r.email!.toLowerCase(), r.id]));
    const principalByName = new Map(principals.map((p) => [p.name.toLowerCase(), p.id]));

    const territoryByName = new Map(
      orgUnits.filter((u) => u.unit_type === "territory").map((u) => [u.name.toLowerCase(), u.id])
    );
    const distributorByName = new Map(
      orgUnits.filter((u) => u.unit_type === "distributor").map((u) => [u.name.toLowerCase(), u.id])
    );
    const routeByName = new Map(routes.map((r) => [r.name.toLowerCase(), r.id]));
    const channelByName = new Map(channels.map((c) => [c.name.toLowerCase(), c.id]));

    async function getOrCreateTerritory(name: string): Promise<string | null> {
      if (!name) return null;
      const key = name.toLowerCase();
      if (territoryByName.has(key)) return territoryByName.get(key)!;
      const { data } = await supabase
        .from("coaching_org_units")
        .insert({ form_id: formId, unit_type: "territory", name })
        .select("id")
        .single();
      if (data) territoryByName.set(key, data.id);
      return data?.id ?? null;
    }
    async function getOrCreateDistributor(name: string, territoryId: string | null): Promise<string | null> {
      if (!name) return null;
      const key = name.toLowerCase();
      if (distributorByName.has(key)) return distributorByName.get(key)!;
      const { data } = await supabase
        .from("coaching_org_units")
        .insert({ form_id: formId, unit_type: "distributor", name, parent_id: territoryId })
        .select("id")
        .single();
      if (data) distributorByName.set(key, data.id);
      return data?.id ?? null;
    }
    async function getOrCreateRoute(name: string, territoryId: string | null): Promise<string | null> {
      if (!name) return null;
      const key = name.toLowerCase();
      if (routeByName.has(key)) return routeByName.get(key)!;
      const { data } = await supabase
        .from("coaching_routes")
        .insert({ form_id: formId, name, territory_id: territoryId })
        .select("id")
        .single();
      if (data) routeByName.set(key, data.id);
      return data?.id ?? null;
    }
    async function getOrCreateChannel(raw: string): Promise<string | null> {
      if (!raw) return null;
      const parts = raw.split(">").map((p) => p.trim()).filter(Boolean);
      let parentId: string | null = null;
      for (const part of parts) {
        const key = part.toLowerCase();
        if (channelByName.has(key)) {
          parentId = channelByName.get(key)!;
          continue;
        }
        const { data }: { data: { id: string } | null } = await supabase
          .from("coaching_channels")
          .insert({ form_id: formId, name: part, parent_id: parentId })
          .select("id")
          .single();
        if (data) channelByName.set(key, data.id);
        parentId = data?.id ?? parentId;
      }
      return parentId;
    }
    async function getOrCreatePrincipal(name: string): Promise<string | null> {
      if (!name) return null;
      const key = name.toLowerCase();
      if (principalByName.has(key)) return principalByName.get(key)!;
      const { data } = await supabase
        .from("coaching_principals")
        .insert({ form_id: formId, name })
        .select("id")
        .single();
      if (data) principalByName.set(key, data.id);
      return data?.id ?? null;
    }

    // Upsert by outlet_code — re-uploading a sheet after fixing a couple of
    // rows shouldn't duplicate every outlet already in the system; matched
    // rows get their fields updated in place, only genuinely new codes insert.
    const existingByCode = new Map(initial.map((o) => [o.outlet_code.toLowerCase(), o.id]));
    let created = 0;
    let updated = 0;
    let errorMsg: string | null = null;
    for (const r of rows) {
      if (!r.outlet_code || !r.name) continue;
      const territoryId = await getOrCreateTerritory((r.territory_name ?? "").trim());
      const distributorId = await getOrCreateDistributor((r.distributor_name ?? "").trim(), territoryId);
      const routeId = await getOrCreateRoute((r.route_name ?? "").trim(), territoryId);
      const channelId = await getOrCreateChannel((r.channel_name ?? "").trim());
      const principalId = await getOrCreatePrincipal((r.principal_name ?? "").trim());
      const fields = {
        name: r.name,
        trading_name: r.trading_name || null,
        contact_person: r.contact_person || null,
        phone: r.phone || null,
        address: r.address || null,
        channel_id: channelId,
        route_id: routeId,
        territory_id: territoryId,
        distributor_id: distributorId,
        principal_id: principalId,
        assigned_sales_rep_id: repByEmail.get((r.assigned_sales_rep_email ?? "").toLowerCase()) ?? null,
        assigned_team_leader_id:
          profileByEmail.get((r.assigned_team_leader_email ?? "").toLowerCase()) ?? null,
        latitude: r.latitude ? Number(r.latitude) : null,
        longitude: r.longitude ? Number(r.longitude) : null,
        geofence_radius_m: r.geofence_radius_m ? Number(r.geofence_radius_m) : 100,
      };
      const existingId = existingByCode.get(r.outlet_code.toLowerCase());
      if (existingId) {
        const { error } = await supabase.from("coaching_outlets").update(fields).eq("id", existingId);
        if (error) errorMsg = error.message;
        else updated++;
      } else {
        const { error } = await supabase
          .from("coaching_outlets")
          .insert({ form_id: formId, outlet_code: r.outlet_code, ...fields });
        if (error) errorMsg = error.message;
        else created++;
      }
    }

    setImporting(false);
    setResult(
      errorMsg
        ? `Error: ${errorMsg}`
        : `${created} outlet(s) created, ${updated} matched existing outlets and updated. Auto-created any new territories/distributors/routes/channels/principals referenced by name.`
    );
    router.refresh();
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => runImport(results.data as Record<string, string>[]),
    });
  }

  return (
    <Panel>
      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <label className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-2 hover:border-[var(--pine-500)] cursor-pointer">
          {importing ? "Importing..." : "Import outlets CSV"}
          <input type="file" accept=".csv" className="hidden" onChange={handleCsvFile} disabled={importing} />
        </label>
        <ExcelUpload onRows={startImport} busy={importing} />
        <TemplateDownloadButton
          filename="outlets_template"
          columns={[
            "outlet_code",
            "name",
            "trading_name",
            "contact_person",
            "phone",
            "address",
            "channel_name",
            "route_name",
            "territory_name",
            "distributor_name",
            "principal_name",
            "assigned_sales_rep_email",
            "assigned_team_leader_email",
            "latitude",
            "longitude",
            "geofence_radius_m",
          ]}
          example={[
            [
              "OUT001",
              "Main Street Store",
              "Main St",
              "Jane Doe",
              "0700000000",
              "123 Main St",
              "Traditional Trade > Duka",
              "Route 1",
              "Nairobi Central",
              "ABC Distributors Ltd",
              "Principal One",
              "rep@example.com",
              "leader@example.com",
              "-1.2921",
              "36.8219",
              "100",
            ],
          ]}
          note="Territories, distributors, routes, channels, and principals are auto-created if the name doesn't exist yet. Rep/Team Leader emails must already exist — upload the roster first."
        />
      </div>
      <p className="text-xs text-[var(--ink-400)] mb-4">
        Territories, distributors, routes, channels, and principals are auto-created if the name
        doesn&apos;t exist yet (use &quot;Parent &gt; Child&quot; in channel_name for a sub-channel).
        Rep/Team Leader emails must already exist — upload the roster first.
      </p>
      {result && <p className="mb-4 text-sm text-[var(--pine-700)]">{result}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="text-left text-[var(--ink-400)] border-b border-[var(--line)]">
              <th className="py-1.5 pr-3">Code</th>
              <th className="py-1.5 pr-3">Name</th>
              <th className="py-1.5 pr-3">Route</th>
              <th className="py-1.5 pr-3">Channel</th>
              <th className="py-1.5 pr-3">Principal</th>
              <th className="py-1.5 pr-3">Sales Rep</th>
              <th className="py-1.5 pr-3">Team Leader</th>
              <th className="py-1.5 pr-3">Geofence (m)</th>
              <th className="py-1.5 pr-3"></th>
            </tr>
          </thead>
          <tbody>
            {initial.slice(0, 100).map((o) =>
              editingId === o.id ? (
                <tr key={o.id} className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                  <td className="py-1.5 pr-3">{o.outlet_code}</td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={editRow.name ?? ""}
                      onChange={(e) => setEditRow((p) => ({ ...p, name: e.target.value }))}
                      className={inputCls}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={editRow.route_id ?? ""}
                      onChange={(e) => setEditRow((p) => ({ ...p, route_id: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={editRow.channel_id ?? ""}
                      onChange={(e) => setEditRow((p) => ({ ...p, channel_id: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={editRow.principal_id ?? ""}
                      onChange={(e) => setEditRow((p) => ({ ...p, principal_id: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {principals.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={editRow.assigned_sales_rep_id ?? ""}
                      onChange={(e) => setEditRow((p) => ({ ...p, assigned_sales_rep_id: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {reps.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.full_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={editRow.assigned_team_leader_id ?? ""}
                      onChange={(e) => setEditRow((p) => ({ ...p, assigned_team_leader_id: e.target.value }))}
                      className={inputCls}
                    >
                      <option value="">—</option>
                      {profiles
                        .filter((p) => p.field_role === "team_leader" || p.field_role === "key_account_rep")
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.full_name ?? p.email}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      value={editRow.geofence_radius_m ?? 100}
                      onChange={(e) =>
                        setEditRow((p) => ({ ...p, geofence_radius_m: Number(e.target.value) }))
                      }
                      className={`${inputCls} w-20`}
                    />
                  </td>
                  <td className="py-1.5 flex gap-2">
                    <button onClick={() => saveEdit(o.id)} className={linkBtnCls}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-[var(--ink-400)]">
                      Cancel
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={o.id} className={`border-b border-[var(--line)] ${!o.is_active ? "opacity-50" : ""}`}>
                  <td className="py-1.5 pr-3">{o.outlet_code}</td>
                  <td className="py-1.5 pr-3">{o.name}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{nameOf(routes, o.route_id)}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{nameOf(channels, o.channel_id)}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{nameOf(principals, o.principal_id)}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{repNameOf(o.assigned_sales_rep_id)}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{emailOf(o.assigned_team_leader_id)}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{o.geofence_radius_m}</td>
                  <td className="py-1.5 pr-3 flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(o.id);
                        setEditRow(o);
                      }}
                      className={linkBtnCls}
                    >
                      Edit
                    </button>
                    <button onClick={() => toggleActive(o)} className={o.is_active ? dangerLinkCls : linkBtnCls}>
                      {o.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        {initial.length > 100 && (
          <p className="mt-2 text-xs text-[var(--ink-400)]">
            Showing first 100 of {initial.length} outlets.
          </p>
        )}
      </div>
    </Panel>
  );
}

function RosterPanel({
  formId,
  initial,
  principals,
  teamLeaderPrincipals,
}: {
  formId: string;
  initial: ProfileRow[];
  principals: CoachingPrincipal[];
  teamLeaderPrincipals: TeamLeaderPrincipalRow[];
}) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState("Pineapps2026!");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editFieldRole, setEditFieldRole] = useState("");
  const [editManagerId, setEditManagerId] = useState("");
  const [editPrincipalIds, setEditPrincipalIds] = useState<string[]>([]);

  async function importRows(rows: Record<string, string>[]) {
    if (tempPassword.length < 6) {
      setResult("Temporary password must be at least 6 characters.");
      return;
    }
    setImporting(true);
    const res = await fetch("/api/admin/coaching-roster", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        formId,
        rows: rows.map((r) => ({
          email: r.email,
          full_name: r.full_name,
          field_role: r.field_role,
          manager_email: r.manager_email,
          employee_code: r.employee_code,
        })),
        tempPassword,
      }),
    });
    const data = await res.json();
    setImporting(false);
    if (!res.ok) {
      setResult(`Error: ${data.error}`);
    } else {
      setResult(
        `Created ${data.created} new account(s), updated ${data.updated}. Added ${data.repsCreated ?? 0} sales rep(s) to their Team Leader's roster.` +
          (data.skippedNoEmail?.length
            ? ` Skipped ${data.skippedNoEmail.length} non-rep row(s) with no email: ${data.skippedNoEmail.slice(0, 10).join(", ")}${data.skippedNoEmail.length > 10 ? ", ..." : ""}.`
            : "") +
          (data.repsNoTeamLeader?.length
            ? ` ${data.repsNoTeamLeader.length} sales rep(s) skipped — Team Leader email not resolved: ${data.repsNoTeamLeader.slice(0, 10).join(", ")}${data.repsNoTeamLeader.length > 10 ? ", ..." : ""}.`
            : "") +
          (data.createErrors?.length ? ` Errors: ${data.createErrors.join("; ")}.` : "") +
          (data.notFound?.length ? ` Could not resolve: ${data.notFound.join(", ")}.` : "") +
          (data.invalidRole?.length ? ` Invalid field_role: ${data.invalidRole.join(", ")}.` : "")
      );
    }
    router.refresh();
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => importRows(results.data as Record<string, string>[]),
    });
    e.target.value = "";
  }

  function startEdit(p: ProfileRow) {
    setEditingId(p.id);
    setEditFullName(p.full_name ?? "");
    setEditFieldRole(p.field_role ?? "");
    setEditManagerId(p.manager_id ?? "");
    setEditPrincipalIds(teamLeaderPrincipals.filter((tp) => tp.team_leader_id === p.id).map((tp) => tp.principal_id));
  }

  async function saveEdit(id: string) {
    const supabase = createClient();
    await supabase
      .from("profiles")
      .update({
        full_name: editFullName || null,
        field_role: editFieldRole || null,
        manager_id: editManagerId || null,
      })
      .eq("id", id);

    // Replace this Team Leader's Principal assignments wholesale.
    await supabase.from("team_leader_principals").delete().eq("team_leader_id", id);
    if (editFieldRole === "team_leader" && editPrincipalIds.length > 0) {
      await supabase
        .from("team_leader_principals")
        .insert(editPrincipalIds.map((principal_id) => ({ team_leader_id: id, principal_id })));
    }

    setEditingId(null);
    router.refresh();
  }

  const managerName = (id: string | null) => initial.find((p) => p.id === id)?.full_name ?? "—";
  const principalNamesFor = (id: string) =>
    teamLeaderPrincipals
      .filter((tp) => tp.team_leader_id === id)
      .map((tp) => principals.find((p) => p.id === tp.principal_id)?.name)
      .filter(Boolean)
      .join(", ") || "—";

  return (
    <Panel>
      <div className="mb-4 space-y-3">
        <div>
          <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
            Temporary password for newly created accounts
          </label>
          <input
            type="text"
            value={tempPassword}
            onChange={(e) => setTempPassword(e.target.value)}
            className="rounded-md border border-[var(--line)] px-3 py-1.5 text-sm w-64"
          />
          <p className="text-xs text-[var(--ink-400)] mt-1">
            Share this with the team yourself — they can sign in and change it from their account.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-2 hover:border-[var(--pine-500)] cursor-pointer">
            {importing ? "Importing..." : "Import roster CSV"}
            <input type="file" accept=".csv" className="hidden" onChange={handleCsvFile} disabled={importing} />
          </label>
          <ExcelUpload onRows={importRows} busy={importing} />
          <TemplateDownloadButton
            filename="roster_template"
            columns={["email", "full_name", "field_role", "manager_email", "employee_code"]}
            example={[
              ["leader@example.com", "Jane Leader", "team_leader", "supervisor@example.com", "EMP001"],
              ["kar@example.com", "Kim Rep", "key_account_rep", "supervisor@example.com", "EMP002"],
              ["", "Rep Name", "sales_rep", "leader@example.com", ""],
            ]}
            note="field_role: team_leader / sales_rep / supervisor / key_account_rep. Sales Reps never get a login — their email column can be blank."
          />
        </div>
      </div>
      {result && <p className="mb-4 text-sm text-[var(--pine-700)]">{result}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--ink-400)] border-b border-[var(--line)]">
            <th className="py-1.5 pr-3">Name</th>
            <th className="py-1.5 pr-3">Email</th>
            <th className="py-1.5 pr-3">Role</th>
            <th className="py-1.5 pr-3">Manager</th>
            <th className="py-1.5 pr-3">Principals</th>
            <th className="py-1.5 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((p) =>
            editingId === p.id ? (
              <tr key={p.id} className="border-b border-[var(--line)] bg-[var(--sand-50)]">
                <td className="py-1.5 pr-3">
                  <input
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className={inputCls}
                  />
                </td>
                <td className="py-1.5 pr-3 text-[var(--ink-600)]">{p.email}</td>
                <td className="py-1.5 pr-3">
                  <select
                    value={editFieldRole}
                    onChange={(e) => setEditFieldRole(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">—</option>
                    <option value="team_leader">team_leader</option>
                    <option value="supervisor">supervisor</option>
                    <option value="key_account_rep">key_account_rep</option>
                  </select>
                </td>
                <td className="py-1.5 pr-3">
                  <select
                    value={editManagerId}
                    onChange={(e) => setEditManagerId(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">—</option>
                    {initial
                      .filter((m) => m.id !== p.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name ?? m.email}
                        </option>
                      ))}
                  </select>
                </td>
                <td className="py-1.5 pr-3">
                  {editFieldRole === "team_leader" ? (
                    <select
                      multiple
                      value={editPrincipalIds}
                      onChange={(e) =>
                        setEditPrincipalIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                      }
                      className={`${inputCls} min-w-[140px]`}
                      size={Math.min(4, Math.max(2, principals.length))}
                    >
                      {principals.map((pr) => (
                        <option key={pr.id} value={pr.id}>
                          {pr.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-[var(--ink-400)]">n/a</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 flex gap-2">
                  <button onClick={() => saveEdit(p.id)} className={linkBtnCls}>
                    Save
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-[var(--ink-400)]">
                    Cancel
                  </button>
                </td>
              </tr>
            ) : (
              <tr key={p.id} className="border-b border-[var(--line)]">
                <td className="py-1.5 pr-3">{p.full_name}</td>
                <td className="py-1.5 pr-3 text-[var(--ink-600)]">{p.email}</td>
                <td className="py-1.5 pr-3 text-[var(--ink-600)]">{p.field_role ?? "—"}</td>
                <td className="py-1.5 pr-3 text-[var(--ink-600)]">{managerName(p.manager_id)}</td>
                <td className="py-1.5 pr-3 text-[var(--ink-600)]">
                  {p.field_role === "team_leader" ? principalNamesFor(p.id) : "—"}
                </td>
                <td className="py-1.5 pr-3">
                  <button onClick={() => startEdit(p)} className={linkBtnCls}>
                    Edit
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </Panel>
  );
}

function PrincipalsPanel({
  formId,
  initial,
  profiles,
  teamLeaderPrincipals,
}: {
  formId: string;
  initial: CoachingPrincipal[];
  profiles: ProfileRow[];
  teamLeaderPrincipals: TeamLeaderPrincipalRow[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [importResult, setImportResult] = useState<string | null>(null);

  const teamLeaders = profiles.filter((p) => p.field_role === "team_leader");
  const leadersFor = (principalId: string) =>
    teamLeaderPrincipals
      .filter((tp) => tp.principal_id === principalId)
      .map((tp) => teamLeaders.find((tl) => tl.id === tp.team_leader_id)?.full_name)
      .filter(Boolean)
      .join(", ") || "—";

  async function add() {
    if (!name.trim()) return;
    setBusy(true);
    await supabase.from("coaching_principals").insert({ form_id: formId, name: name.trim() });
    setBusy(false);
    setName("");
    router.refresh();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    await supabase.from("coaching_principals").update({ name: editName.trim() }).eq("id", id);
    setEditingId(null);
    router.refresh();
  }

  async function toggleActive(p: CoachingPrincipal) {
    await supabase.from("coaching_principals").update({ is_active: !p.is_active }).eq("id", p.id);
    router.refresh();
  }

  async function handleImportRows(rows: Record<string, string>[]) {
    const existingKey = new Map(initial.map((p) => [p.name.toLowerCase(), p.id]));
    let updated = 0;
    let created = 0;
    let errorMsg: string | null = null;
    for (const r of rows) {
      if (!r.name) continue;
      const existingId = existingKey.get(r.name.toLowerCase());
      if (existingId) {
        const { error } = await supabase.from("coaching_principals").update({ is_active: true }).eq("id", existingId);
        if (error) errorMsg = error.message;
        else updated++;
      } else {
        const { error } = await supabase.from("coaching_principals").insert({ form_id: formId, name: r.name });
        if (error) errorMsg = error.message;
        else created++;
      }
    }
    setImportResult(
      errorMsg ? `Error: ${errorMsg}` : `${created} created, ${updated} matched existing rows (left alone).`
    );
    router.refresh();
  }

  return (
    <Panel>
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Principal (supplier) name"
          className={`flex-1 min-w-[160px] ${inputCls}`}
        />
        <button disabled={busy} onClick={add} className={btnCls}>
          + Add
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <ExcelUpload onRows={handleImportRows} busy={busy} />
        <TemplateDownloadButton
          filename="principals_template"
          columns={["name"]}
          example={[["Principal One"], ["Principal Two"]]}
          note="Assign Team Leaders to a Principal from the Roster tab's Edit form (a Team Leader may serve more than one Principal)."
        />
      </div>
      {importResult && <p className="mb-4 text-sm text-[var(--pine-700)]">{importResult}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--ink-400)] border-b border-[var(--line)]">
            <th className="py-1.5 pr-3">Principal</th>
            <th className="py-1.5 pr-3">Team Leaders</th>
            <th className="py-1.5 pr-3"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((p) => (
            <tr key={p.id} className={`border-b border-[var(--line)] ${!p.is_active ? "opacity-50" : ""}`}>
              {editingId === p.id ? (
                <>
                  <td className="py-1.5 pr-3">
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={inputCls}
                      autoFocus
                    />
                  </td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{leadersFor(p.id)}</td>
                  <td className="py-1.5 pr-3 flex gap-2">
                    <button onClick={() => saveEdit(p.id)} className={linkBtnCls}>
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-[var(--ink-400)]">
                      Cancel
                    </button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-1.5 pr-3">{p.name}</td>
                  <td className="py-1.5 pr-3 text-[var(--ink-600)]">{leadersFor(p.id)}</td>
                  <td className="py-1.5 pr-3 flex gap-2">
                    <button
                      onClick={() => {
                        setEditingId(p.id);
                        setEditName(p.name);
                      }}
                      className={linkBtnCls}
                    >
                      Edit
                    </button>
                    <button onClick={() => toggleActive(p)} className={p.is_active ? dangerLinkCls : linkBtnCls}>
                      {p.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
