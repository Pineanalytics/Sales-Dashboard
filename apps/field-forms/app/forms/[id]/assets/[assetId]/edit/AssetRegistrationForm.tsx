"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { transitionAsset } from "@/lib/assetLifecycle";
import { findDuplicateAssets, normalizeIdValue, isValidImei } from "@/lib/assetDuplicates";
import { notifyFormAdmins, notifyUser } from "@/lib/notify";
import {
  ASSET_CONDITIONS,
  LAPTOP_ACCESSORIES,
  OWNERSHIP_TYPES,
  USAGE_TYPES,
  type Asset,
  type AssetCategory,
  type AssetFieldRule,
  type AssetPhoto,
} from "@/lib/assetTypes";
import { QrScanner } from "@/components/QrScanner";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { AssetPhotoUpload } from "@/components/AssetPhotoUpload";

const inputClass =
  "w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]";
const labelClass = "block text-sm font-medium text-[var(--ink-900)] mb-1.5";

interface ProfileInfo {
  email: string;
  fullName: string;
  employeeNumber: string;
  jobTitle: string;
  department: string;
  costCentre: string;
  territory: string;
  workLocation: string;
  managerName: string | null;
}

const STEPS = [
  "Employee details",
  "Asset identification",
  "Allocation",
  "Condition & photos",
  "Signature",
  "Confirm",
] as const;

export default function AssetRegistrationForm({
  formId,
  asset,
  formTitle,
  declarationText,
  profile,
  categories,
  fieldRules,
  initialPhotos,
}: {
  formId: string;
  asset: Asset;
  formTitle: string;
  declarationText: string;
  profile: ProfileInfo;
  categories: AssetCategory[];
  fieldRules: AssetFieldRule[];
  initialPhotos: AssetPhoto[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const sigRef = useRef<SignaturePadHandle>(null);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [scanningField, setScanningField] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [issueSent, setIssueSent] = useState(false);

  type EditableFields = Omit<Partial<Asset>, "condition" | "ownership_type" | "usage_type"> & {
    condition?: string;
    ownership_type?: string;
    usage_type?: string;
  };

  const [fields, setFields] = useState<EditableFields>({
    asset_number: asset.asset_number ?? "",
    category_id: asset.category_id ?? "",
    subcategory_id: asset.subcategory_id ?? "",
    description: asset.description ?? "",
    manufacturer: asset.manufacturer ?? "",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serial_number: asset.serial_number ?? "",
    barcode: asset.barcode ?? "",
    qr_value: asset.qr_value ?? "",
    imei: asset.imei ?? "",
    vehicle_reg: asset.vehicle_reg ?? "",
    engine_number: asset.engine_number ?? "",
    chassis_vin: asset.chassis_vin ?? "",
    sim_number: asset.sim_number ?? "",
    po_number: asset.po_number ?? "",
    supplier: asset.supplier ?? "",
    purchase_date: asset.purchase_date ?? "",
    purchase_cost: asset.purchase_cost ?? undefined,
    warranty_start: asset.warranty_start ?? "",
    warranty_end: asset.warranty_end ?? "",
    ownership_type: asset.ownership_type ?? "",
    usage_type: asset.usage_type ?? "",
    current_department: asset.current_department ?? profile.department ?? "",
    current_cost_centre: asset.current_cost_centre ?? profile.costCentre ?? "",
    current_location: asset.current_location ?? profile.workLocation ?? "",
    custodian: asset.custodian ?? "",
    allocation_date: asset.allocation_date ?? "",
    expected_return_date: asset.expected_return_date ?? "",
    allocation_purpose: asset.allocation_purpose ?? "",
    condition: asset.condition ?? "",
    condition_notes: asset.condition_notes ?? "",
    damage_description: asset.damage_description ?? "",
    operational_test_result: asset.operational_test_result ?? "",
  });
  const [accessoriesReceived, setAccessoriesReceived] = useState<string[]>(
    asset.accessories_received ?? []
  );
  const [missingAccessories, setMissingAccessories] = useState<string[]>(
    asset.missing_accessories ?? []
  );
  const [photos, setPhotos] = useState<Record<string, string | null>>({
    full: initialPhotos.find((p) => p.kind === "full")?.storage_url ?? null,
    serial_label: initialPhotos.find((p) => p.kind === "serial_label")?.storage_url ?? null,
    damage: initialPhotos.find((p) => p.kind === "damage")?.storage_url ?? null,
    document: initialPhotos.find((p) => p.kind === "document")?.storage_url ?? null,
    screenshot: initialPhotos.find((p) => p.kind === "screenshot")?.storage_url ?? null,
  });
  const [typedName, setTypedName] = useState(profile.fullName || "");
  const [consent, setConsent] = useState(false);

  const topLevel = categories.filter((c) => !c.parent_id);
  const subOptions = categories.filter((c) => c.parent_id === fields.category_id);
  const selectedSub = categories.find((c) => c.id === fields.subcategory_id);
  const selectedTop = categories.find((c) => c.id === fields.category_id);
  const categoryName = selectedSub?.name ?? selectedTop?.name ?? "";
  const isComputer = categoryName === "Laptops" || categoryName === "Desktop computers";

  const requiredFieldKeys = useMemo(() => {
    const catId = fields.subcategory_id || fields.category_id;
    return new Set(
      fieldRules.filter((r) => r.category_id === catId && r.is_required).map((r) => r.field_key)
    );
  }, [fieldRules, fields.category_id, fields.subcategory_id]);

  // A field is shown once a rule row exists for it (required or optional) —
  // categories with no rule for e.g. "engine_number" simply don't have that
  // identifier, so there's nothing to scan or fill in. Barcode/QR are the
  // universal Pinefrost asset tag and apply to every category.
  const UNIVERSAL_ID_FIELDS = new Set(["barcode", "qr_value"]);
  const visibleFieldKeys = useMemo(() => {
    const catId = fields.subcategory_id || fields.category_id;
    const fromRules = new Set(fieldRules.filter((r) => r.category_id === catId).map((r) => r.field_key));
    for (const key of UNIVERSAL_ID_FIELDS) fromRules.add(key);
    return fromRules;
  }, [fieldRules, fields.category_id, fields.subcategory_id]);

  function setField<K extends keyof EditableFields>(key: K, value: EditableFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  const DATE_FIELD_KEYS = [
    "purchase_date",
    "warranty_start",
    "warranty_end",
    "allocation_date",
    "expected_return_date",
  ] as const;
  const NULLABLE_UUID_KEYS = ["category_id", "subcategory_id"] as const;
  const NULLABLE_ENUM_KEYS = ["condition", "ownership_type", "usage_type"] as const;
  // asset_number has a unique index "where not null" — an empty string is a
  // real (non-null) value, so multiple blank drafts would collide on it.
  const NULLABLE_UNIQUE_TEXT_KEYS = ["asset_number"] as const;

  async function saveDraft() {
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = { ...fields };
    for (const key of DATE_FIELD_KEYS) {
      if (payload[key] === "") payload[key] = null;
    }
    for (const key of NULLABLE_UUID_KEYS) {
      if (payload[key] === "") payload[key] = null;
    }
    for (const key of NULLABLE_ENUM_KEYS) {
      if (payload[key] === "") payload[key] = null;
    }
    for (const key of NULLABLE_UNIQUE_TEXT_KEYS) {
      if (payload[key] === "") payload[key] = null;
    }
    if (payload.purchase_cost === undefined || Number.isNaN(payload.purchase_cost)) {
      payload.purchase_cost = null;
    }
    const { error: err } = await supabase
      .from("assets")
      .update({ ...payload, accessories_received: accessoriesReceived, missing_accessories: missingAccessories, updated_at: new Date().toISOString() })
      .eq("id", asset.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return false;
    }
    return true;
  }

  async function checkDuplicates() {
    const matches = await findDuplicateAssets(
      supabase,
      formId,
      {
        asset_number: fields.asset_number || undefined,
        serial_number: fields.serial_number || undefined,
        imei: fields.imei || undefined,
        vehicle_reg: fields.vehicle_reg || undefined,
        barcode: fields.barcode || undefined,
        qr_value: fields.qr_value || undefined,
      },
      asset.id
    );
    if (matches.length > 0) {
      setDuplicateWarning(
        `Possible duplicate: ${matches[0].field.replace("_", " ")} "${matches[0].value}" already matches asset ${
          matches[0].matchedAssetNumber ?? matches[0].matchedAssetId.slice(0, 8)
        } (status: ${matches[0].matchedStatus}). This will be flagged for admin review.`
      );
      for (const m of matches) {
        await supabase.from("asset_duplicates_flagged").insert({
          asset_id: asset.id,
          matched_asset_id: m.matchedAssetId,
          matched_on: m.field,
        });
      }
    } else {
      setDuplicateWarning(null);
    }
  }

  async function handleScanResult(fieldKey: string, value: string) {
    setField(fieldKey as keyof Asset, normalizeIdValue(value) as never);
    setScanningField(null);
    // A scan of a Pinefrost asset label should load the existing record
    // instead of creating a duplicate.
    const matches = await findDuplicateAssets(supabase, formId, { [fieldKey]: value } as any, asset.id);
    if (matches.length > 0 && matches[0].matchedStatus !== "Draft") {
      router.push(`/forms/${formId}/assets`);
    }
  }

  async function runOcr(file: File) {
    setOcrBusy(true);
    setError(null);
    try {
      const { default: Tesseract } = await import("tesseract.js");
      const result = await Tesseract.recognize(file, "eng");
      const guess = result.data.text.replace(/[^A-Za-z0-9-]/g, "").trim();
      if (guess) {
        setField("serial_number", normalizeIdValue(guess) as never);
      } else {
        setError("Could not read a serial number from that photo — please enter it manually.");
      }
    } catch {
      setError("OCR failed — please enter the serial number manually.");
    }
    setOcrBusy(false);
  }

  async function reportProfileIssue() {
    if (!issueNote.trim()) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("notifications").insert({
      recipient_id: asset.created_by, // placeholder recipient resolved server-side normally; admins pick up via queue
      kind: "profile_correction_request",
      message: `${profile.fullName || profile.email} reported incorrect profile info: ${issueNote}`,
    });
    setIssueSent(true);
    setIssueNote("");
  }

  async function goNext() {
    setError(null);
    if (step === 1) await checkDuplicates();
    const ok = await saveDraft();
    if (!ok) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  function validateBeforeSubmit(): string | null {
    if (!fields.category_id) return "Please select an asset category.";
    for (const key of requiredFieldKeys) {
      if (!(fields as any)[key]) return `Please complete the required field: ${key.replace("_", " ")}.`;
    }
    if (fields.imei && !isValidImei(fields.imei)) return "IMEI must be 15 digits.";
    if (!fields.condition) return "Please select a condition.";
    if (!photos.full) return "Please upload a photo of the entire asset.";
    if (sigRef.current?.isEmpty()) return "Please sign the declaration.";
    if (!typedName.trim()) return "Please type your full name to confirm the signature.";
    if (!consent) return "Please confirm the consent checkbox.";
    return null;
  }

  async function handleSubmit() {
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);

    const saved = await saveDraft();
    if (!saved) {
      setSaving(false);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setSaving(false);
      setError("You must be signed in.");
      return;
    }

    // Signature
    const dataUrl = sigRef.current!.toDataURL();
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${formId}/${asset.id}/signature-${crypto.randomUUID()}.png`;
    const { error: upErr } = await supabase.storage
      .from("asset-documents")
      .upload(path, blob, { contentType: "image/png" });
    if (upErr) {
      setSaving(false);
      setError(upErr.message);
      return;
    }
    const { data: signedUrlData } = await supabase.storage
      .from("asset-documents")
      .createSignedUrl(path, 60 * 60 * 24 * 365);

    const { error: sigErr } = await supabase.from("asset_signatures").insert({
      asset_id: asset.id,
      event_type: "registration",
      signer_id: user.id,
      typed_name: typedName.trim(),
      employee_number: profile.employeeNumber || null,
      signature_image_url: signedUrlData?.signedUrl ?? path,
      device_ref: navigator.userAgent,
    });
    if (sigErr) {
      setSaving(false);
      setError(sigErr.message);
      return;
    }

    const { error: transErr } = await transitionAsset(supabase, {
      assetId: asset.id,
      from: asset.status,
      to: "Submitted",
      actorId: user.id,
    });
    if (transErr) {
      setSaving(false);
      setError(transErr);
      return;
    }

    // Route straight to whichever review stage actually applies — a
    // category not configured for manager review (or an employee with no
    // manager on file) goes straight to admin verification.
    const needsManagerReview = Boolean(selectedSub?.requires_manager_review) && Boolean(profile.managerName);
    const { error: routeErr } = await transitionAsset(supabase, {
      assetId: asset.id,
      from: "Submitted",
      to: needsManagerReview ? "Pending Manager Review" : "Pending Admin Verification",
      actorId: user.id,
    });
    setSaving(false);
    if (routeErr) {
      setError(routeErr);
      return;
    }

    if (needsManagerReview) {
      // Notified via is_manager_of visibility — find the manager id from the
      // employee's own profile so the notification reaches the right person.
      const { data: me } = await supabase.from("profiles").select("manager_id").eq("id", user.id).single();
      if (me?.manager_id) {
        await notifyUser(supabase, me.manager_id, "manager_review_required", `${profile.fullName || profile.email} submitted an asset for your review.`, asset.id);
      }
    } else {
      await notifyFormAdmins(supabase, formId, "submission_received", `${profile.fullName || profile.email} submitted an asset for verification.`, asset.id);
    }

    router.push(`/forms/${formId}/assets`);
    router.refresh();
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          {formTitle}
        </p>
        <h1 className="font-display text-2xl text-[var(--ink-900)] mb-6">
          Register an asset
        </h1>

        <div className="flex flex-wrap gap-2 mb-8 text-xs">
          {STEPS.map((label, i) => (
            <span
              key={label}
              className={`px-2.5 py-1 rounded-full ${
                i === step
                  ? "bg-[var(--pine-700)] text-white"
                  : i < step
                    ? "bg-[var(--pine-100)] text-[var(--pine-700)]"
                    : "bg-[var(--sand-100)] text-[var(--ink-400)]"
              }`}
            >
              {i + 1}. {label}
            </span>
          ))}
        </div>

        <div className="bg-white border border-[var(--line)] rounded-lg p-6 space-y-5">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg text-[var(--ink-900)]">
                Employee details
              </h2>
              <p className="text-sm text-[var(--ink-600)]">
                These come from your profile and cannot be edited here.
              </p>
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Name", profile.fullName || "—"],
                  ["Employee number", profile.employeeNumber || "—"],
                  ["Job title", profile.jobTitle || "—"],
                  ["Department", profile.department || "—"],
                  ["Cost centre", profile.costCentre || "—"],
                  ["Team / territory", profile.territory || "—"],
                  ["Work location", profile.workLocation || "—"],
                  ["Email", profile.email],
                  ["Line manager", profile.managerName || "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs font-mono-label uppercase tracking-wide text-[var(--ink-400)]">
                      {k}
                    </dt>
                    <dd className="text-[var(--ink-900)]">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="pt-2 border-t border-[var(--line)]">
                {issueSent ? (
                  <p className="text-sm text-[var(--pine-700)]">
                    Thanks — an admin has been notified.
                  </p>
                ) : (
                  <>
                    <label className={labelClass}>
                      Something above is incorrect? Describe it here.
                    </label>
                    <textarea
                      value={issueNote}
                      onChange={(e) => setIssueNote(e.target.value)}
                      rows={2}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={reportProfileIssue}
                      className="mt-2 text-xs font-medium text-[var(--pine-700)] hover:underline"
                    >
                      Report incorrect information
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg text-[var(--ink-900)]">
                Asset identification
              </h2>

              <div>
                <label className={labelClass}>Asset category</label>
                <select
                  value={fields.category_id ?? ""}
                  onChange={(e) => {
                    setField("category_id", e.target.value as never);
                    setField("subcategory_id", "" as never);
                  }}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {topLevel.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {subOptions.length > 0 && (
                <div>
                  <label className={labelClass}>Subcategory</label>
                  <select
                    value={fields.subcategory_id ?? ""}
                    onChange={(e) => setField("subcategory_id", e.target.value as never)}
                    className={inputClass}
                  >
                    <option value="">Select…</option>
                    {subOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={labelClass}>Description</label>
                <input
                  type="text"
                  value={fields.description ?? ""}
                  onChange={(e) => setField("description", e.target.value as never)}
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Manufacturer</label>
                  <input
                    type="text"
                    value={fields.manufacturer ?? ""}
                    onChange={(e) => setField("manufacturer", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Brand</label>
                  <input
                    type="text"
                    value={fields.brand ?? ""}
                    onChange={(e) => setField("brand", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Model</label>
                  <input
                    type="text"
                    value={fields.model ?? ""}
                    onChange={(e) => setField("model", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Pinefrost asset number</label>
                  <input
                    type="text"
                    value={fields.asset_number ?? ""}
                    onChange={(e) => setField("asset_number", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
              </div>

              {isComputer && (
                <div className="rounded-md border border-[var(--line)] bg-[var(--pine-50)] p-4 text-sm">
                  <p className="font-medium text-[var(--ink-900)] mb-2">
                    How to find this computer&apos;s serial number
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-[var(--ink-600)] mb-3">
                    <li>Open Windows PowerShell.</li>
                    <li>Paste the command below.</li>
                    <li>Press Enter.</li>
                    <li>Copy the serial number shown.</li>
                    <li>Paste it into the Serial Number field below.</li>
                    <li>Confirm it matches the physical label where possible.</li>
                  </ol>
                  <CopyCommand cmd="Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber" />
                  <p className="text-xs text-[var(--ink-600)] mt-2 mb-1">Or, for full device info:</p>
                  <CopyCommand cmd={`Get-CimInstance Win32_ComputerSystemProduct |\nSelect-Object Vendor, Name, IdentifyingNumber`} />
                  <p className="text-xs text-[var(--ink-400)] mt-3">
                    macOS: Apple menu → About This Mac → Serial Number.
                    <br />
                    Android: Settings → About phone → Status → Serial number.
                    <br />
                    iOS: Settings → General → About → Serial Number.
                  </p>
                </div>
              )}

              {visibleFieldKeys.has("serial_number") && (
                <IdField
                  label="Serial number"
                  required={requiredFieldKeys.has("serial_number")}
                  value={fields.serial_number ?? ""}
                  onChange={(v) => setField("serial_number", v as never)}
                  onScan={() => setScanningField("serial_number")}
                  scanning={scanningField === "serial_number"}
                  onScanResult={(v) => handleScanResult("serial_number", v)}
                  onScanCancel={() => setScanningField(null)}
                />
              )}

              {isComputer && (
                <div>
                  <label className={labelClass}>
                    Or photograph the serial-number label (OCR suggestion)
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    disabled={ocrBusy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) runOcr(file);
                    }}
                    className="text-sm"
                  />
                  {ocrBusy && (
                    <p className="text-xs text-[var(--ink-600)] mt-1">Reading label…</p>
                  )}
                  <p className="text-xs text-[var(--ink-400)] mt-1">
                    The suggested value is placed in the Serial Number field above — always
                    confirm it matches the label before continuing.
                  </p>
                </div>
              )}

              <IdField
                label="Barcode"
                required={requiredFieldKeys.has("barcode")}
                value={fields.barcode ?? ""}
                onChange={(v) => setField("barcode", v as never)}
                onScan={() => setScanningField("barcode")}
                scanning={scanningField === "barcode"}
                onScanResult={(v) => handleScanResult("barcode", v)}
                onScanCancel={() => setScanningField(null)}
              />
              <IdField
                label="QR-code value"
                required={requiredFieldKeys.has("qr_value")}
                value={fields.qr_value ?? ""}
                onChange={(v) => setField("qr_value", v as never)}
                onScan={() => setScanningField("qr_value")}
                scanning={scanningField === "qr_value"}
                onScanResult={(v) => handleScanResult("qr_value", v)}
                onScanCancel={() => setScanningField(null)}
              />
              {visibleFieldKeys.has("imei") && (
                <IdField
                  label="IMEI (phones / cellular tablets)"
                  required={requiredFieldKeys.has("imei")}
                  value={fields.imei ?? ""}
                  onChange={(v) => setField("imei", v as never)}
                  onScan={() => setScanningField("imei")}
                  scanning={scanningField === "imei"}
                  onScanResult={(v) => handleScanResult("imei", v)}
                  onScanCancel={() => setScanningField(null)}
                />
              )}
              {visibleFieldKeys.has("vehicle_reg") && (
                <IdField
                  label="Vehicle registration number"
                  required={requiredFieldKeys.has("vehicle_reg")}
                  value={fields.vehicle_reg ?? ""}
                  onChange={(v) => setField("vehicle_reg", v as never)}
                />
              )}
              <div className="grid grid-cols-2 gap-4">
                {visibleFieldKeys.has("engine_number") && (
                  <div>
                    <label className={labelClass}>Engine number</label>
                    <input
                      type="text"
                      value={fields.engine_number ?? ""}
                      onChange={(e) => setField("engine_number", e.target.value as never)}
                      className={inputClass}
                    />
                  </div>
                )}
                {visibleFieldKeys.has("chassis_vin") && (
                  <div>
                    <label className={labelClass}>Chassis / VIN</label>
                    <input
                      type="text"
                      value={fields.chassis_vin ?? ""}
                      onChange={(e) => setField("chassis_vin", e.target.value as never)}
                      className={inputClass}
                    />
                  </div>
                )}
                {visibleFieldKeys.has("sim_number") && (
                  <div>
                    <label className={labelClass}>SIM number</label>
                    <input
                      type="text"
                      value={fields.sim_number ?? ""}
                      onChange={(e) => setField("sim_number", e.target.value as never)}
                      className={inputClass}
                    />
                  </div>
                )}
                <div>
                  <label className={labelClass}>Purchase order number</label>
                  <input
                    type="text"
                    value={fields.po_number ?? ""}
                    onChange={(e) => setField("po_number", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Supplier</label>
                  <input
                    type="text"
                    value={fields.supplier ?? ""}
                    onChange={(e) => setField("supplier", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Purchase date</label>
                  <input
                    type="date"
                    value={fields.purchase_date ?? ""}
                    onChange={(e) => setField("purchase_date", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Purchase cost</label>
                  <input
                    type="number"
                    value={fields.purchase_cost ?? ""}
                    onChange={(e) => setField("purchase_cost", parseFloat(e.target.value) as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Warranty start</label>
                  <input
                    type="date"
                    value={fields.warranty_start ?? ""}
                    onChange={(e) => setField("warranty_start", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Warranty expiry</label>
                  <input
                    type="date"
                    value={fields.warranty_end ?? ""}
                    min={fields.warranty_start ?? undefined}
                    onChange={(e) => setField("warranty_end", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
              </div>

              {duplicateWarning && (
                <p className="text-sm text-[var(--rust-600)]" role="alert">
                  ⚠ {duplicateWarning}
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg text-[var(--ink-900)]">
                Allocation information
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Department</label>
                  <input
                    type="text"
                    value={fields.current_department ?? ""}
                    onChange={(e) => setField("current_department", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Cost centre</label>
                  <input
                    type="text"
                    value={fields.current_cost_centre ?? ""}
                    onChange={(e) => setField("current_cost_centre", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Location / branch / depot</label>
                  <input
                    type="text"
                    value={fields.current_location ?? ""}
                    onChange={(e) => setField("current_location", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Custodian</label>
                  <input
                    type="text"
                    value={fields.custodian ?? ""}
                    onChange={(e) => setField("custodian", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Allocation date</label>
                  <input
                    type="date"
                    value={fields.allocation_date ?? ""}
                    onChange={(e) => setField("allocation_date", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Expected return date (if temporary)</label>
                  <input
                    type="date"
                    min={fields.allocation_date ?? undefined}
                    value={fields.expected_return_date ?? ""}
                    onChange={(e) => setField("expected_return_date", e.target.value as never)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Ownership type</label>
                  <select
                    value={fields.ownership_type ?? ""}
                    onChange={(e) => setField("ownership_type", e.target.value as never)}
                    className={inputClass}
                  >
                    <option value="">Select…</option>
                    {OWNERSHIP_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Usage type</label>
                  <select
                    value={fields.usage_type ?? ""}
                    onChange={(e) => setField("usage_type", e.target.value as never)}
                    className={inputClass}
                  >
                    <option value="">Select…</option>
                    {USAGE_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClass}>Allocation purpose</label>
                <input
                  type="text"
                  value={fields.allocation_purpose ?? ""}
                  onChange={(e) => setField("allocation_purpose", e.target.value as never)}
                  className={inputClass}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg text-[var(--ink-900)]">
                Condition assessment
              </h2>
              <div>
                <label className={labelClass}>Condition</label>
                <select
                  value={fields.condition ?? ""}
                  onChange={(e) => setField("condition", e.target.value as never)}
                  className={inputClass}
                >
                  <option value="">Select…</option>
                  {ASSET_CONDITIONS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Condition notes</label>
                <textarea
                  rows={2}
                  value={fields.condition_notes ?? ""}
                  onChange={(e) => setField("condition_notes", e.target.value as never)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Existing damage description</label>
                <textarea
                  rows={2}
                  value={fields.damage_description ?? ""}
                  onChange={(e) => setField("damage_description", e.target.value as never)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Operational test result</label>
                <input
                  type="text"
                  value={fields.operational_test_result ?? ""}
                  onChange={(e) => setField("operational_test_result", e.target.value as never)}
                  className={inputClass}
                />
              </div>

              {categoryName === "Laptops" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Accessories received</label>
                    <div className="flex flex-col gap-1.5">
                      {LAPTOP_ACCESSORIES.map((a) => (
                        <label key={a} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={accessoriesReceived.includes(a)}
                            onChange={(e) =>
                              setAccessoriesReceived((prev) =>
                                e.target.checked ? [...prev, a] : prev.filter((x) => x !== a)
                              )
                            }
                            className="accent-[var(--pine-600)]"
                          />
                          {a}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Missing accessories</label>
                    <div className="flex flex-col gap-1.5">
                      {LAPTOP_ACCESSORIES.map((a) => (
                        <label key={a} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={missingAccessories.includes(a)}
                            onChange={(e) =>
                              setMissingAccessories((prev) =>
                                e.target.checked ? [...prev, a] : prev.filter((x) => x !== a)
                              )
                            }
                            className="accent-[var(--pine-600)]"
                          />
                          {a}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <AssetPhotoUpload
                  assetId={asset.id}
                  kind="full"
                  label="Photo of the entire asset"
                  value={photos.full}
                  onChange={(url) => setPhotos((p) => ({ ...p, full: url }))}
                />
                <AssetPhotoUpload
                  assetId={asset.id}
                  kind="serial_label"
                  label="Photo of serial-number label"
                  value={photos.serial_label}
                  onChange={(url) => setPhotos((p) => ({ ...p, serial_label: url }))}
                />
                <AssetPhotoUpload
                  assetId={asset.id}
                  kind="damage"
                  label="Photo of existing damage (if any)"
                  value={photos.damage}
                  onChange={(url) => setPhotos((p) => ({ ...p, damage: url }))}
                />
                <AssetPhotoUpload
                  assetId={asset.id}
                  kind="document"
                  label="Supporting document"
                  value={photos.document}
                  onChange={(url) => setPhotos((p) => ({ ...p, document: url }))}
                />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg text-[var(--ink-900)]">
                Signature & declaration
              </h2>
              <p className="text-sm text-[var(--ink-600)] bg-[var(--sand-50)] border border-[var(--line)] rounded-md p-4">
                {declarationText}
              </p>
              <SignaturePad ref={sigRef} />
              <div>
                <label className={labelClass}>Type your full name to confirm</label>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className={inputClass}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--ink-900)]">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="accent-[var(--pine-600)]"
                />
                I confirm the above declaration and consent to submit this registration.
              </label>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg text-[var(--ink-900)]">
                Confirm and submit
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <SummaryRow label="Category" value={categoryName || "—"} />
                <SummaryRow label="Description" value={fields.description || "—"} />
                <SummaryRow label="Serial number" value={fields.serial_number || "—"} />
                <SummaryRow label="Asset number" value={fields.asset_number || "—"} />
                <SummaryRow label="Condition" value={fields.condition || "—"} />
                <SummaryRow label="Location" value={fields.current_location || "—"} />
              </dl>
              <p className="text-xs text-[var(--ink-400)]">
                Submitting sends this for {" "}
                {isComputer || fields.category_id ? "verification" : "review"} — you can no
                longer edit it unless it&apos;s returned to you for correction.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--rust-600)]" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-[var(--line)]">
            <button
              type="button"
              onClick={goBack}
              disabled={step === 0 || saving}
              className="text-sm font-medium text-[var(--ink-600)] hover:text-[var(--pine-700)] disabled:opacity-40"
            >
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={saving}
                className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-5 py-2.5 hover:bg-[var(--pine-900)] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save & continue"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={saving}
                className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-5 py-2.5 hover:bg-[var(--pine-900)] disabled:opacity-60"
              >
                {saving ? "Submitting…" : "Submit for verification"}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-mono-label uppercase tracking-wide text-[var(--ink-400)]">
        {label}
      </dt>
      <dd className="text-[var(--ink-900)]">{value}</dd>
    </div>
  );
}

function CopyCommand({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 bg-white border border-[var(--line)] rounded-md p-2">
      <pre className="flex-1 text-xs whitespace-pre-wrap font-mono">{cmd}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 text-xs font-medium text-[var(--pine-700)] hover:underline"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function IdField({
  label,
  required,
  value,
  onChange,
  onScan,
  scanning,
  onScanResult,
  onScanCancel,
}: {
  label: string;
  required: boolean;
  value: string;
  onChange: (v: string) => void;
  onScan?: () => void;
  scanning?: boolean;
  onScanResult?: (v: string) => void;
  onScanCancel?: () => void;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required && <span className="text-[var(--rust-600)]"> *</span>}
      </label>
      <div className="flex gap-2">
        <input
          type="text"
          required={required}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
        {onScan && (
          <button
            type="button"
            onClick={onScan}
            className="shrink-0 rounded-md border border-[var(--line)] px-3 py-2 text-sm hover:border-[var(--pine-500)]"
          >
            📷 Scan
          </button>
        )}
      </div>
      {scanning && onScanResult && onScanCancel && (
        <div className="mt-2">
          <QrScanner onDetected={onScanResult} onClose={onScanCancel} />
        </div>
      )}
    </div>
  );
}
