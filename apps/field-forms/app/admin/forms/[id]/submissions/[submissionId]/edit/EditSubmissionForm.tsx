"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FormRecord } from "@/lib/types";
import { FieldInput } from "@/components/FormFieldInput";
import { isFieldRequired } from "@/lib/formRules";

export default function EditSubmissionForm({
  form,
  submissionId,
  initialAnswers,
}: {
  form: FormRecord;
  submissionId: string;
  initialAnswers: Record<string, string | string[]>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const allFields = form.form_sections.flatMap((s) => s.form_fields);
  const [answers, setAnswers] =
    useState<Record<string, string | string[]>>(initialAnswers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setValue(fieldId: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
    setSaved(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const missing: string[] = [];
    for (const section of form.form_sections) {
      for (const field of section.form_fields) {
        if (!isFieldRequired(field, answers, allFields)) continue;
        const v = answers[field.id];
        const isEmpty =
          v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
        if (isEmpty) missing.push(field.label);
      }
    }
    if (missing.length > 0) {
      setError(`Please complete: ${missing.join(", ")}`);
      return;
    }

    setSaving(true);

    const { error: delErr } = await supabase
      .from("submission_answers")
      .delete()
      .eq("submission_id", submissionId);

    if (delErr) {
      setError(delErr.message);
      setSaving(false);
      return;
    }

    const rows = Object.entries(answers)
      .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== ""))
      .map(([field_id, v]) => ({
        submission_id: submissionId,
        field_id,
        value: Array.isArray(v) ? v.join(", ") : v,
      }));

    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from("submission_answers")
        .insert(rows);
      if (insErr) {
        setError(insErr.message);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {form.form_sections.map((section) => (
        <div
          key={section.id}
          className="bg-white border border-[var(--line)] rounded-lg p-6"
        >
          <h2 className="font-display text-lg text-[var(--ink-900)] mb-1">
            {section.title}
          </h2>
          {section.description && (
            <p className="text-sm text-[var(--ink-600)] mb-4">
              {section.description}
            </p>
          )}
          <div className="space-y-5 mt-4">
            {section.form_fields.map((field) => (
              <div key={field.id}>
                <label className="block text-sm font-medium text-[var(--ink-900)] mb-1.5">
                  {field.label}
                  {isFieldRequired(field, answers, allFields) && (
                    <span className="text-[var(--rust-600)]"> *</span>
                  )}
                </label>
                <FieldInput
                  field={field}
                  value={
                    answers[field.id] ??
                    (field.field_type === "checkbox" ||
                    field.field_type === "multiselect"
                      ? []
                      : "")
                  }
                  onChange={(v) => setValue(field.id, v)}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {error && (
        <p className="text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-[var(--pine-700)]">Changes saved.</p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-3 hover:bg-[var(--pine-900)] transition-colors disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
