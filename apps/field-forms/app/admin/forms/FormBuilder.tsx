"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FieldType } from "@/lib/types";

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown (single)" },
  { value: "radio", label: "Radio (single)" },
  { value: "multiselect", label: "Multi-select (searchable dropdown)" },
  { value: "checkbox", label: "Checkboxes" },
  { value: "photo", label: "Photo upload" },
  { value: "shelf_calculator", label: "Share of Shelf calculator (auto %)" },
];

const OPTIONS_TYPES: FieldType[] = [
  "select",
  "radio",
  "multiselect",
  "checkbox",
];

interface BuilderField {
  tempId: string;
  label: string;
  field_type: FieldType;
  // Raw comma-separated text — the source of truth while editing. Parsing
  // this into an array on every keystroke (and reflecting the parsed array
  // back into the input's value) fights the user: typing a comma to start
  // a new option gets immediately stripped by the empty-token filter, so
  // the field appears to "skip" commas and never let you finish typing.
  // Only split into an options[] array at save time.
  optionsText: string;
  required: boolean;
  placeholder: string;
}

interface BuilderSection {
  tempId: string;
  title: string;
  description: string;
  fields: BuilderField[];
}

function parseOptions(text: string): string[] {
  return text
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function newField(): BuilderField {
  return {
    tempId: crypto.randomUUID(),
    label: "",
    field_type: "text",
    optionsText: "",
    required: false,
    placeholder: "",
  };
}

function newSection(): BuilderSection {
  return {
    tempId: crypto.randomUUID(),
    title: "",
    description: "",
    fields: [newField()],
  };
}

export default function FormBuilder({
  formId,
  initialTitle = "",
  initialDescription = "",
  initialIsActive = true,
  initialSections,
}: {
  formId?: string;
  initialTitle?: string;
  initialDescription?: string;
  initialIsActive?: boolean;
  initialSections?: BuilderSection[];
}) {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [isActive, setIsActive] = useState(initialIsActive);
  const [sections, setSections] = useState<BuilderSection[]>(
    initialSections && initialSections.length > 0
      ? initialSections
      : [newSection()]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  function updateSection(tempId: string, patch: Partial<BuilderSection>) {
    setSections((prev) =>
      prev.map((s) => (s.tempId === tempId ? { ...s, ...patch } : s))
    );
  }

  function updateField(
    sectionId: string,
    fieldId: string,
    patch: Partial<BuilderField>
  ) {
    setSections((prev) =>
      prev.map((s) =>
        s.tempId === sectionId
          ? {
              ...s,
              fields: s.fields.map((f) =>
                f.tempId === fieldId ? { ...f, ...patch } : f
              ),
            }
          : s
      )
    );
  }

  async function handleSave() {
    setError(null);
    setWarnings([]);
    if (!title.trim()) {
      setError("Form title is required.");
      return;
    }
    for (const s of sections) {
      if (!s.title.trim()) {
        setError("Every section needs a title.");
        return;
      }
      for (const f of s.fields) {
        if (!f.label.trim()) {
          setError("Every field needs a label.");
          return;
        }
        if (
          OPTIONS_TYPES.includes(f.field_type) &&
          parseOptions(f.optionsText).length === 0
        ) {
          setError(`Field "${f.label}" needs at least one option.`);
          return;
        }
      }
    }

    setSaving(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let currentFormId = formId;

    if (currentFormId) {
      const { error: updErr } = await supabase
        .from("forms")
        .update({ title, description, is_active: isActive })
        .eq("id", currentFormId);
      if (updErr) {
        setError(updErr.message);
        setSaving(false);
        return;
      }
    } else {
      const { data: form, error: insErr } = await supabase
        .from("forms")
        .insert({
          title,
          description,
          is_active: isActive,
          created_by: user?.id,
        })
        .select("id")
        .single();
      if (insErr || !form) {
        setError(insErr?.message ?? "Could not create form.");
        setSaving(false);
        return;
      }
      currentFormId = form.id;
    }

    // Update/insert sections and fields by id rather than wiping and
    // recreating them — submission_answers references field ids directly,
    // so deleting a field that already has answers is rejected by the
    // database. Removed sections/fields are only actually deleted when
    // that succeeds (i.e. nothing depends on them yet); otherwise they're
    // silently kept and we tell the admin why.
    const initialSectionIds = new Set((initialSections ?? []).map((s) => s.tempId));
    const currentSectionIds = new Set(sections.map((s) => s.tempId));
    const skipped: string[] = [];

    for (const sid of initialSectionIds) {
      if (!currentSectionIds.has(sid)) {
        const { error: delErr } = await supabase
          .from("form_sections")
          .delete()
          .eq("id", sid);
        if (delErr) {
          const removedSection = initialSections?.find((s) => s.tempId === sid);
          skipped.push(
            `Section "${removedSection?.title ?? "Untitled"}" has existing submissions and was kept instead of removed.`
          );
        }
      }
    }

    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      let sectionId = s.tempId;

      if (initialSectionIds.has(s.tempId)) {
        const { error: sErr } = await supabase
          .from("form_sections")
          .update({
            title: s.title,
            description: s.description || null,
            order_index: i,
          })
          .eq("id", sectionId);
        if (sErr) {
          setError(sErr.message);
          setSaving(false);
          return;
        }
      } else {
        const { data: sectionRow, error: sErr } = await supabase
          .from("form_sections")
          .insert({
            form_id: currentFormId,
            title: s.title,
            description: s.description || null,
            order_index: i,
          })
          .select("id")
          .single();
        if (sErr || !sectionRow) {
          setError(sErr?.message ?? "Could not save section.");
          setSaving(false);
          return;
        }
        sectionId = sectionRow.id;
      }

      const initialSection = initialSections?.find((is) => is.tempId === s.tempId);
      const initialFieldIds = new Set(
        (initialSection?.fields ?? []).map((f) => f.tempId)
      );
      const currentFieldIds = new Set(s.fields.map((f) => f.tempId));

      for (const fid of initialFieldIds) {
        if (!currentFieldIds.has(fid)) {
          const { error: delErr } = await supabase
            .from("form_fields")
            .delete()
            .eq("id", fid);
          if (delErr) {
            // Existing answers reference this field, so it can't be hard
            // deleted — archive it instead: hidden from the live form and
            // every dashboard/export, but its past answers stay intact.
            const { error: archiveErr } = await supabase
              .from("form_fields")
              .update({ is_active: false })
              .eq("id", fid);
            const removedField = initialSection?.fields.find((f) => f.tempId === fid);
            skipped.push(
              archiveErr
                ? `Field "${removedField?.label ?? "Untitled"}" could not be removed or archived: ${archiveErr.message}`
                : `Field "${removedField?.label ?? "Untitled"}" has existing submissions, so it was archived (hidden from the form and reports) instead of deleted.`
            );
          }
        }
      }

      for (let idx = 0; idx < s.fields.length; idx++) {
        const f = s.fields[idx];
        const payload = {
          section_id: sectionId,
          label: f.label,
          field_type: f.field_type,
          options: OPTIONS_TYPES.includes(f.field_type)
            ? parseOptions(f.optionsText)
            : null,
          required: f.required,
          placeholder: f.placeholder || null,
          order_index: idx,
        };

        if (initialFieldIds.has(f.tempId)) {
          const { error: fErr } = await supabase
            .from("form_fields")
            .update(payload)
            .eq("id", f.tempId);
          if (fErr) {
            setError(fErr.message);
            setSaving(false);
            return;
          }
        } else {
          const { error: fErr } = await supabase.from("form_fields").insert(payload);
          if (fErr) {
            setError(fErr.message);
            setSaving(false);
            return;
          }
        }
      }
    }

    setSaving(false);
    if (skipped.length > 0) {
      // Stay on the page so the admin actually sees why something wasn't
      // removed, instead of losing the message on redirect.
      setWarnings(skipped);
      router.refresh();
      return;
    }
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
        {formId ? "Edit form" : "New form"}
      </p>

      <div className="bg-white border border-[var(--line)] rounded-lg p-6 mb-6">
        <div className="mb-4">
          <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
            Form title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Weekly Outlet Audit"
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
          />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--ink-900)]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="accent-[var(--pine-600)]"
          />
          Active (visible to users)
        </label>
      </div>

      <div className="space-y-5">
        {sections.map((section, sIdx) => (
          <div
            key={section.tempId}
            className="bg-white border border-[var(--line)] rounded-lg p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono-label text-xs uppercase tracking-wide text-[var(--ink-400)]">
                Section {sIdx + 1}
              </span>
              {sections.length > 1 && (
                <button
                  onClick={() =>
                    setSections((prev) =>
                      prev.filter((s) => s.tempId !== section.tempId)
                    )
                  }
                  className="text-xs text-[var(--rust-600)] hover:underline"
                >
                  Remove section
                </button>
              )}
            </div>

            <div className="mb-3">
              <input
                type="text"
                value={section.title}
                onChange={(e) =>
                  updateSection(section.tempId, { title: e.target.value })
                }
                placeholder="Section title"
                className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
              />
            </div>
            <div className="mb-5">
              <input
                type="text"
                value={section.description}
                onChange={(e) =>
                  updateSection(section.tempId, {
                    description: e.target.value,
                  })
                }
                placeholder="Section description (optional)"
                className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
              />
            </div>

            <div className="space-y-4">
              {section.fields.map((field, fIdx) => (
                <div
                  key={field.tempId}
                  className="border border-[var(--line)] rounded-md p-4 bg-[var(--sand-50)]"
                >
                  <div className="flex items-start gap-3 mb-3">
                    <input
                      type="text"
                      value={field.label}
                      onChange={(e) =>
                        updateField(section.tempId, field.tempId, {
                          label: e.target.value,
                        })
                      }
                      placeholder={`Field ${fIdx + 1} label`}
                      className="flex-1 rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
                    />
                    <select
                      value={field.field_type}
                      onChange={(e) =>
                        updateField(section.tempId, field.tempId, {
                          field_type: e.target.value as FieldType,
                        })
                      }
                      className="rounded-md border border-[var(--line)] px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
                    >
                      {FIELD_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {section.fields.length > 1 && (
                      <button
                        onClick={() =>
                          updateSection(section.tempId, {
                            fields: section.fields.filter(
                              (f) => f.tempId !== field.tempId
                            ),
                          })
                        }
                        className="text-xs text-[var(--rust-600)] hover:underline px-1 py-2"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {OPTIONS_TYPES.includes(field.field_type) && (
                    <div className="mb-3">
                      <label className="block text-xs text-[var(--ink-600)] mb-1">
                        Options (comma separated)
                      </label>
                      <input
                        type="text"
                        value={field.optionsText}
                        onChange={(e) =>
                          updateField(section.tempId, field.tempId, {
                            optionsText: e.target.value,
                          })
                        }
                        placeholder="e.g. Yes, No, Unsure"
                        className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]"
                      />
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-[var(--ink-600)]">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) =>
                        updateField(section.tempId, field.tempId, {
                          required: e.target.checked,
                        })
                      }
                      className="accent-[var(--pine-600)]"
                    />
                    Required
                  </label>
                </div>
              ))}
            </div>

            <button
              onClick={() =>
                updateSection(section.tempId, {
                  fields: [...section.fields, newField()],
                })
              }
              className="mt-4 text-sm text-[var(--pine-700)] hover:underline"
            >
              + Add field
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={() => setSections((prev) => [...prev, newSection()])}
        className="mt-4 text-sm text-[var(--pine-700)] hover:underline"
      >
        + Add section
      </button>

      {error && (
        <p className="mt-4 text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="mt-4 rounded-md border border-[var(--line)] bg-[var(--sand-50)] p-4">
          <p className="text-sm font-medium text-[var(--ink-900)] mb-1">
            Saved — with a couple of notes:
          </p>
          <ul className="text-sm text-[var(--ink-600)] list-disc list-inside space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-5 py-2.5 hover:bg-[var(--pine-900)] transition-colors disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save form"}
        </button>
      </div>
    </div>
  );
}
