"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { transitionAsset } from "@/lib/assetLifecycle";
import type { Asset } from "@/lib/assetTypes";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";

export default function AcknowledgeForm({
  formId,
  asset,
  declarationText,
  brandName,
  fullName,
  employeeNumber,
}: {
  formId: string;
  asset: Asset;
  declarationText: string;
  brandName: string;
  fullName: string;
  employeeNumber: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const sigRef = useRef<SignaturePadHandle>(null);
  const [typedName, setTypedName] = useState(fullName);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAcknowledge() {
    setError(null);
    if (sigRef.current?.isEmpty()) {
      setError("Please sign to acknowledge.");
      return;
    }
    if (!typedName.trim() || !consent) {
      setError("Please type your name and confirm the consent checkbox.");
      return;
    }
    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      setSaving(false);
      return;
    }

    const dataUrl = sigRef.current!.toDataURL();
    const blob = await (await fetch(dataUrl)).blob();
    const path = `${formId}/${asset.id}/acknowledgement-${crypto.randomUUID()}.png`;
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
      event_type: "acknowledgement",
      signer_id: user.id,
      typed_name: typedName.trim(),
      employee_number: employeeNumber || null,
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
      to: "Active",
      actorId: user.id,
      comment: `Acknowledged by employee (${asset.status.toLowerCase()}).`,
    });
    setSaving(false);
    if (transErr) {
      setError(transErr);
      return;
    }

    router.push(`/forms/${formId}/assets`);
    router.refresh();
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          {brandName}
        </p>
        <h1 className="font-display text-2xl text-[var(--ink-900)] mb-6">
          Acknowledge {asset.status.toLowerCase()} asset
        </h1>

        <div className="bg-white border border-[var(--line)] rounded-lg p-6 space-y-4">
          <p className="text-sm text-[var(--ink-900)]">
            {asset.description || asset.asset_number}
          </p>
          <p className="text-sm text-[var(--ink-600)] bg-[var(--sand-50)] border border-[var(--line)] rounded-md p-4">
            {declarationText}
          </p>
          <SignaturePad ref={sigRef} />
          <div>
            <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
              Type your full name to confirm
            </label>
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--ink-900)]">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="accent-[var(--pine-600)]"
            />
            I confirm receipt/possession as described above.
          </label>

          {error && (
            <p className="text-sm text-[var(--rust-600)]" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={handleAcknowledge}
            className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-3 hover:bg-[var(--pine-900)] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Acknowledge"}
          </button>
        </div>
      </div>
    </main>
  );
}
