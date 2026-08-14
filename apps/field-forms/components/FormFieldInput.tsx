"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { compressImage } from "@/lib/imageCompress";
import type { FormField } from "@/lib/types";

export function ShelfCalculator({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [ownFacings, setOwnFacings] = useState("");
  const [totalFacings, setTotalFacings] = useState("");

  const computed = useMemo(() => {
    const own = parseFloat(ownFacings);
    const total = parseFloat(totalFacings);
    if (!isFinite(own) || !isFinite(total) || total <= 0) return null;
    return Math.round((own / total) * 1000) / 10;
  }, [ownFacings, totalFacings]);

  function apply(nextOwn: string, nextTotal: string) {
    const own = parseFloat(nextOwn);
    const total = parseFloat(nextTotal);
    if (isFinite(own) && isFinite(total) && total > 0) {
      onChange(String(Math.round((own / total) * 1000) / 10));
    } else {
      onChange("");
    }
  }

  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--pine-50)] p-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-[var(--ink-600)] mb-1">
            Our brand&apos;s facings
          </label>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={ownFacings}
            onChange={(e) => {
              setOwnFacings(e.target.value);
              apply(e.target.value, totalFacings);
            }}
            placeholder="e.g. 6"
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--ink-600)] mb-1">
            Total shelf facings
          </label>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={totalFacings}
            onChange={(e) => {
              setTotalFacings(e.target.value);
              apply(ownFacings, e.target.value);
            }}
            placeholder="e.g. 24"
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
          />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-md bg-white border border-[var(--line)] px-3 py-2">
        <span className="text-xs text-[var(--ink-600)]">Share of shelf</span>
        <span className="font-display text-lg text-[var(--pine-700)]">
          {computed !== null ? `${computed}%` : value ? `${value}%` : "—"}
        </span>
      </div>
    </div>
  );
}

export function SearchableMultiSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt));
    else onChange([...value, opt]);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-md border border-[var(--line)] px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)] bg-white"
      >
        <span className="truncate text-[var(--ink-900)]">
          {value.length > 0
            ? `${value.length} selected`
            : "Tap to select…"}
        </span>
        <span className="text-[var(--ink-400)] shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 bg-[var(--pine-100)] text-[var(--pine-700)] text-xs rounded-full pl-2.5 pr-1.5 py-1"
            >
              {v}
              <button
                type="button"
                onClick={() => toggle(v)}
                className="hover:text-[var(--rust-600)]"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-[var(--line)] bg-white shadow-lg">
          <div className="p-2 border-b border-[var(--line)]">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-md border border-[var(--line)] px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-[var(--ink-600)]">
                No matches
              </p>
            )}
            {filtered.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--ink-900)] hover:bg-[var(--sand-50)] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={value.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-[var(--pine-600)]"
                />
                {opt}
              </label>
            ))}
          </div>
          <div className="p-2 border-t border-[var(--line)] flex justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs font-medium text-[var(--pine-700)] hover:underline px-2 py-1"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PhotoField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const supabase = createClient();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);

    // Raw camera captures run 3-4MB uncompressed, which times out on slow
    // field-network connections. Shrinking client-side first both avoids
    // that timeout and saves the field team's mobile data.
    const upload = await compressImage(file).catch(() => file);
    const ext = upload.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;

    // Uploads over flaky mobile connections fail intermittently even after
    // compression — retry a couple of times with a short backoff before
    // surfacing an error, rather than making the user notice and retry by
    // hand (that gap is how field submissions silently went missing).
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
      const { error: upErr } = await supabase.storage
        .from("shelf-photos")
        .upload(path, upload, { upsert: attempt > 0 });
      if (!upErr) {
        lastError = null;
        break;
      }
      lastError = upErr.message;
    }

    if (lastError) {
      setError(lastError);
      setUploading(false);
      return;
    }

    const { data } = supabase.storage.from("shelf-photos").getPublicUrl(path);
    onChange(data.publicUrl);
    setUploading(false);
  }

  return (
    <div>
      {value ? (
        <div className="flex items-center gap-3">
          <img
            src={value}
            alt="Shelf photo"
            className="h-20 w-20 object-cover rounded-md border border-[var(--line)]"
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-xs text-[var(--rust-600)] hover:underline"
          >
            Remove and retake
          </button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-1 border border-dashed border-[var(--line)] rounded-md py-6 cursor-pointer text-sm text-[var(--ink-600)] hover:border-[var(--pine-500)]">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {uploading ? "Uploading…" : "Tap to take or choose a photo"}
        </label>
      )}
      {error && (
        <p className="mt-1 text-xs text-[var(--rust-600)]">{error}</p>
      )}
    </div>
  );
}

export function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string | string[];
  onChange: (v: string | string[]) => void;
}) {
  const base =
    "w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]";

  switch (field.field_type) {
    case "photo":
      return (
        <PhotoField
          value={value as string}
          onChange={(v) => onChange(v)}
        />
      );
    case "textarea":
      return (
        <textarea
          required={field.required}
          placeholder={field.placeholder ?? ""}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          className={base}
        />
      );
    case "select":
      return (
        <select
          required={field.required}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-[var(--ink-900)]"
            >
              <input
                type="radio"
                required={field.required}
                name={field.id}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="accent-[var(--pine-600)]"
              />
              {opt}
            </label>
          ))}
        </div>
      );
    case "checkbox": {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-2">
          {(field.options ?? []).map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-[var(--ink-900)]"
            >
              <input
                type="checkbox"
                checked={arr.includes(opt)}
                onChange={(e) => {
                  if (e.target.checked) onChange([...arr, opt]);
                  else onChange(arr.filter((v) => v !== opt));
                }}
                className="accent-[var(--pine-600)]"
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case "multiselect": {
      const arr = Array.isArray(value) ? value : [];
      return (
        <SearchableMultiSelect
          options={field.options ?? []}
          value={arr}
          onChange={(v) => onChange(v)}
        />
      );
    }
    case "shelf_calculator":
      return (
        <ShelfCalculator value={value as string} onChange={(v) => onChange(v)} />
      );
    case "number":
      return (
        <input
          type="number"
          required={field.required}
          placeholder={field.placeholder ?? ""}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      );
    case "date":
      return (
        <input
          type="date"
          required={field.required}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      );
    case "email":
      return (
        <input
          type="email"
          required={field.required}
          placeholder={field.placeholder ?? ""}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      );
    case "phone":
      return (
        <input
          type="tel"
          required={field.required}
          placeholder={field.placeholder ?? ""}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      );
    default:
      return (
        <input
          type="text"
          required={field.required}
          placeholder={field.placeholder ?? ""}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          className={base}
        />
      );
  }
}
