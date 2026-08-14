"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { transitionAsset } from "@/lib/assetLifecycle";
import { notifyUser } from "@/lib/notify";
import type {
  Asset,
  AssetCategory,
  AssetDuplicateFlag,
  AssetEvent,
  AssetPhoto,
  AssetSignature,
} from "@/lib/assetTypes";

const inputClass =
  "w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]";

function fieldRow(label: string, value: string | number | null | undefined) {
  return (
    <div>
      <dt className="text-xs font-mono-label uppercase tracking-wide text-[var(--ink-400)]">
        {label}
      </dt>
      <dd className="text-[var(--ink-900)] text-sm">{value ?? "—"}</dd>
    </div>
  );
}

export default function AssetDetail({
  formId,
  asset,
  categories,
  photos,
  signatures,
  events,
  duplicates,
  employeeName,
  actorNames,
  employees,
}: {
  formId: string;
  asset: Asset;
  categories: AssetCategory[];
  photos: AssetPhoto[];
  signatures: AssetSignature[];
  events: AssetEvent[];
  duplicates: AssetDuplicateFlag[];
  employeeName: string | null;
  actorNames: Record<string, string>;
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const category = categories.find((c) => c.id === asset.category_id);
  const subcategory = categories.find((c) => c.id === asset.subcategory_id);

  async function currentUser() {
    const { data } = await supabase.auth.getUser();
    return data.user;
  }

  async function doTransition(to: Asset["status"], requireReason: boolean, extra?: Record<string, unknown>) {
    if (requireReason && !reason.trim()) {
      setError("A reason is required for this action.");
      return;
    }
    const user = await currentUser();
    if (!user) return;
    setBusy(true);
    setError(null);
    const { error: err } = await transitionAsset(supabase, {
      assetId: asset.id,
      from: asset.status,
      to,
      actorId: user.id,
      comment: reason || undefined,
      extraAssetFields: extra,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    if (asset.current_employee_id) {
      const messages: Partial<Record<Asset["status"], string>> = {
        "Returned for Correction": `Your asset submission was returned for correction: ${reason}`,
        Rejected: `Your asset submission was rejected: ${reason}`,
        Lost: `Your asset was marked as lost: ${reason}`,
        Stolen: `Your asset was marked as stolen: ${reason}`,
        Retired: `Your asset was retired: ${reason}`,
        Disposed: `Your asset was disposed: ${reason}`,
        Returned: "Your asset return was recorded.",
        "Under Repair": "Your asset was marked as under repair.",
        Active: "Your asset was reactivated.",
      };
      const message = messages[to];
      if (message) {
        await notifyUser(supabase, asset.current_employee_id, "status_change", message, asset.id);
      }
    }
    setReason("");
    router.refresh();
  }

  async function verifyAndActivate() {
    const user = await currentUser();
    if (!user) return;
    setBusy(true);
    setError(null);
    const step1 = await transitionAsset(supabase, {
      assetId: asset.id,
      from: asset.status,
      to: "Verified",
      actorId: user.id,
      comment: reason || "Verified by admin.",
    });
    if (step1.error) {
      setBusy(false);
      setError(step1.error);
      return;
    }
    const step2 = await transitionAsset(supabase, {
      assetId: asset.id,
      from: "Verified",
      to: "Active",
      actorId: user.id,
    });
    setBusy(false);
    if (step2.error) {
      setError(step2.error);
      return;
    }
    if (asset.current_employee_id) {
      await notifyUser(supabase, asset.current_employee_id, "verified", "Your asset has been verified and activated.", asset.id);
    }
    setReason("");
    router.refresh();
  }

  async function doTransfer() {
    if (!transferTo) {
      setError("Please select who the asset is being transferred to.");
      return;
    }
    const user = await currentUser();
    if (!user) return;
    setBusy(true);
    setError(null);
    const { error: updErr } = await supabase
      .from("assets")
      .update({ current_employee_id: transferTo, updated_at: new Date().toISOString() })
      .eq("id", asset.id);
    if (updErr) {
      setBusy(false);
      setError(updErr.message);
      return;
    }
    const { error: err } = await transitionAsset(supabase, {
      assetId: asset.id,
      from: asset.status,
      to: "Transferred",
      actorId: user.id,
      comment: reason || `Transferred to ${employees.find((e) => e.id === transferTo)?.name ?? transferTo}`,
    });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    await notifyUser(supabase, transferTo, "asset_transferred", "An asset has been allocated to you. A fresh signature will be required to acknowledge it.", asset.id);
    setReason("");
    setTransferTo("");
    router.refresh();
  }

  async function addNote() {
    if (!note.trim()) return;
    const user = await currentUser();
    if (!user) return;
    setBusy(true);
    const { error: err } = await supabase.from("asset_events").insert({
      asset_id: asset.id,
      event_type: "admin_note",
      actor_id: user.id,
      comment: note,
    });
    setBusy(false);
    if (err) setError(err.message);
    else {
      setNote("");
      router.refresh();
    }
  }

  async function resolveDuplicate(dupId: string) {
    setBusy(true);
    const { error: err } = await supabase
      .from("asset_duplicates_flagged")
      .update({ resolved: true })
      .eq("id", dupId);
    setBusy(false);
    if (err) setError(err.message);
    else router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[var(--line)] rounded-lg p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="font-display text-xl text-[var(--ink-900)]">
              {asset.description || asset.asset_number || "Untitled asset"}
            </h2>
            <p className="text-sm text-[var(--ink-600)]">{employeeName ?? "Unassigned"}</p>
          </div>
          <span className="shrink-0 text-xs font-mono-label uppercase tracking-wide rounded-full px-2.5 py-1 bg-[var(--pine-100)] text-[var(--pine-700)]">
            {asset.status}
          </span>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {fieldRow("Category", category?.name)}
          {fieldRow("Subcategory", subcategory?.name)}
          {fieldRow("Asset number", asset.asset_number)}
          {fieldRow("Manufacturer", asset.manufacturer)}
          {fieldRow("Brand", asset.brand)}
          {fieldRow("Model", asset.model)}
          {fieldRow("Serial number", asset.serial_number)}
          {fieldRow("Barcode", asset.barcode)}
          {fieldRow("QR value", asset.qr_value)}
          {fieldRow("IMEI", asset.imei)}
          {fieldRow("Vehicle reg", asset.vehicle_reg)}
          {fieldRow("Chassis/VIN", asset.chassis_vin)}
          {fieldRow("Engine number", asset.engine_number)}
          {fieldRow("SIM number", asset.sim_number)}
          {fieldRow("Supplier", asset.supplier)}
          {fieldRow("PO number", asset.po_number)}
          {fieldRow("Purchase date", asset.purchase_date)}
          {fieldRow("Purchase cost", asset.purchase_cost)}
          {fieldRow("Warranty end", asset.warranty_end)}
          {fieldRow("Ownership", asset.ownership_type)}
          {fieldRow("Usage type", asset.usage_type)}
          {fieldRow("Department", asset.current_department)}
          {fieldRow("Cost centre", asset.current_cost_centre)}
          {fieldRow("Location", asset.current_location)}
          {fieldRow("Custodian", asset.custodian)}
          {fieldRow("Condition", asset.condition)}
        </dl>
        {asset.condition_notes && (
          <p className="mt-3 text-sm text-[var(--ink-600)]">
            <span className="font-medium text-[var(--ink-900)]">Condition notes: </span>
            {asset.condition_notes}
          </p>
        )}
        {asset.damage_description && (
          <p className="mt-1 text-sm text-[var(--ink-600)]">
            <span className="font-medium text-[var(--ink-900)]">Damage: </span>
            {asset.damage_description}
          </p>
        )}
      </div>

      {duplicates.length > 0 && (
        <div className="bg-white border border-[var(--rust-600)] rounded-lg p-5">
          <h3 className="font-display text-base text-[var(--rust-600)] mb-3">
            Possible duplicates flagged
          </h3>
          <ul className="space-y-2">
            {duplicates.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>
                  Matches asset {d.matched_asset_id.slice(0, 8)} on {d.matched_on.replace("_", " ")}
                </span>
                <button
                  disabled={busy}
                  onClick={() => resolveDuplicate(d.id)}
                  className="text-xs font-medium text-[var(--pine-700)] hover:underline"
                >
                  Mark resolved
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {photos.length > 0 && (
        <div className="bg-white border border-[var(--line)] rounded-lg p-5">
          <h3 className="font-display text-base text-[var(--ink-900)] mb-3">Photos</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {photos.map((p) => (
              <a key={p.id} href={p.storage_url} target="_blank" rel="noreferrer">
                <img
                  src={p.storage_url}
                  alt={p.kind}
                  className="aspect-square w-full object-cover rounded-md border border-[var(--line)]"
                />
                <p className="text-xs text-[var(--ink-400)] mt-1">{p.kind.replace("_", " ")}</p>
              </a>
            ))}
          </div>
        </div>
      )}

      {signatures.length > 0 && (
        <div className="bg-white border border-[var(--line)] rounded-lg p-5">
          <h3 className="font-display text-base text-[var(--ink-900)] mb-3">Signature</h3>
          {signatures.map((s) => (
            <div key={s.id} className="flex items-center gap-4">
              <img
                src={s.signature_image_url}
                alt="Signature"
                className="h-20 border border-[var(--line)] rounded-md bg-white"
              />
              <div className="text-sm text-[var(--ink-600)]">
                <p className="text-[var(--ink-900)] font-medium">{s.typed_name}</p>
                <p>{new Date(s.consent_at).toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-[var(--line)] rounded-lg p-5">
        <h3 className="font-display text-base text-[var(--ink-900)] mb-3">Actions</h3>
        {error && (
          <p className="text-sm text-[var(--rust-600)] mb-3" role="alert">
            {error}
          </p>
        )}
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason / comment (required for reject, return, retire, dispose)"
          rows={2}
          className={`${inputClass} mb-3`}
        />

        <div className="flex flex-wrap gap-2">
          {asset.status === "Pending Admin Verification" && (
            <>
              <ActionButton onClick={verifyAndActivate} busy={busy} primary>
                Verify & approve
              </ActionButton>
              <ActionButton onClick={() => doTransition("Returned for Correction", true)} busy={busy}>
                Return for correction
              </ActionButton>
              <ActionButton onClick={() => doTransition("Rejected", true)} busy={busy} danger>
                Reject
              </ActionButton>
            </>
          )}

          {(asset.status === "Active" ||
            asset.status === "Transferred" ||
            asset.status === "Returned" ||
            asset.status === "Under Repair") && (
            <>
              <ActionButton onClick={() => doTransition("Returned", false)} busy={busy}>
                Mark as returned
              </ActionButton>
              <ActionButton onClick={() => doTransition("Under Repair", false)} busy={busy}>
                Mark under repair
              </ActionButton>
              <ActionButton onClick={() => doTransition("Active", false)} busy={busy}>
                Reactivate
              </ActionButton>
              <ActionButton onClick={() => doTransition("Lost", true)} busy={busy} danger>
                Report lost
              </ActionButton>
              <ActionButton onClick={() => doTransition("Stolen", true)} busy={busy} danger>
                Report stolen
              </ActionButton>
              <ActionButton onClick={() => doTransition("Retired", true)} busy={busy}>
                Retire
              </ActionButton>
              <ActionButton onClick={() => doTransition("Disposed", true)} busy={busy} danger>
                Dispose
              </ActionButton>
            </>
          )}

          {(asset.status === "Lost" || asset.status === "Stolen" || asset.status === "Retired") && (
            <>
              <ActionButton onClick={() => doTransition("Retired", true)} busy={busy}>
                Retire
              </ActionButton>
              <ActionButton onClick={() => doTransition("Disposed", true)} busy={busy} danger>
                Dispose
              </ActionButton>
            </>
          )}
        </div>

        {(asset.status === "Active" ||
          asset.status === "Transferred" ||
          asset.status === "Under Repair" ||
          asset.status === "Returned") && (
          <div className="mt-4 pt-4 border-t border-[var(--line)] flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
                Transfer to
              </label>
              <select
                value={transferTo}
                onChange={(e) => setTransferTo(e.target.value)}
                className={inputClass}
              >
                <option value="">Select employee…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <ActionButton onClick={doTransfer} busy={busy}>
              Transfer
            </ActionButton>
          </div>
        )}
      </div>

      <div className="bg-white border border-[var(--line)] rounded-lg p-5">
        <h3 className="font-display text-base text-[var(--ink-900)] mb-3">
          Confidential administrative notes
        </h3>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
          />
          <button
            disabled={busy}
            onClick={addNote}
            className="shrink-0 rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-60"
          >
            Add note
          </button>
        </div>
        {events
          .filter((e) => e.event_type === "admin_note")
          .map((e) => (
            <p key={e.id} className="text-sm text-[var(--ink-600)] mb-1">
              <span className="text-[var(--ink-400)]">
                {new Date(e.created_at).toLocaleString()} —{" "}
                {actorNames[e.actor_id ?? ""] ?? "Admin"}:
              </span>{" "}
              {e.comment}
            </p>
          ))}
      </div>

      <div className="bg-white border border-[var(--line)] rounded-lg p-5">
        <h3 className="font-display text-base text-[var(--ink-900)] mb-3">
          Full history
        </h3>
        <ul className="space-y-2 text-sm">
          {events.map((e) => (
            <li key={e.id} className="border-b border-[var(--line)] last:border-0 pb-2">
              <span className="text-[var(--ink-400)]">
                {new Date(e.created_at).toLocaleString()}
              </span>{" "}
              <span className="font-medium text-[var(--ink-900)]">
                {e.event_type.replace(/_/g, " ")}
              </span>{" "}
              by {actorNames[e.actor_id ?? ""] ?? "system"}
              {e.comment && (
                <p className="text-[var(--ink-600)] mt-0.5">{e.comment}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  busy,
  primary,
  danger,
  children,
}: {
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const base = "rounded-md text-sm font-medium px-3.5 py-2 disabled:opacity-60 transition-colors";
  const style = primary
    ? "bg-[var(--pine-700)] text-white hover:bg-[var(--pine-900)]"
    : danger
      ? "border border-[var(--rust-600)] text-[var(--rust-600)] hover:bg-[#f5e2dd]"
      : "border border-[var(--line)] text-[var(--ink-600)] hover:border-[var(--pine-500)] hover:text-[var(--pine-700)]";
  return (
    <button disabled={busy} onClick={onClick} className={`${base} ${style}`}>
      {children}
    </button>
  );
}
