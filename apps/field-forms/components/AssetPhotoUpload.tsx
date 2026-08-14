"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PhotoKind } from "@/lib/assetTypes";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function AssetPhotoUpload({
  assetId,
  kind,
  label,
  value,
  onChange,
}: {
  assetId: string;
  kind: PhotoKind;
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const supabase = createClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Only JPG, PNG, WEBP, or PDF files are allowed.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is too large (max 10MB).");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${assetId}/${kind}-${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("asset-photos")
      .upload(path, file, { upsert: false });
    if (upErr) {
      setError(upErr.message);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("asset-photos").getPublicUrl(path);

    const { error: insErr } = await supabase.from("asset_photos").insert({
      asset_id: assetId,
      kind,
      storage_url: data.publicUrl,
    });
    if (insErr) {
      setError(insErr.message);
      setUploading(false);
      return;
    }

    onChange(data.publicUrl);
    setUploading(false);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-[var(--ink-900)] mb-1.5">
        {label}
      </label>
      {value ? (
        <div className="flex items-center gap-3">
          {value.endsWith(".pdf") ? (
            <a
              href={value}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[var(--pine-700)] hover:underline"
            >
              View uploaded document
            </a>
          ) : (
            <img
              src={value}
              alt={label}
              className="h-20 w-20 object-cover rounded-md border border-[var(--line)]"
            />
          )}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-[var(--rust-600)] hover:underline"
          >
            Remove and retake
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-1 border border-dashed border-[var(--line)] rounded-md py-6 cursor-pointer text-sm text-[var(--ink-600)] hover:border-[var(--pine-500)]">
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {uploading ? "Uploading…" : "Tap to take or choose a file"}
        </label>
      )}
      {error && <p className="mt-1 text-xs text-[var(--rust-600)]">{error}</p>}
    </div>
  );
}
