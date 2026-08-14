"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FormRecord } from "@/lib/types";
import { FieldInput } from "@/components/FormFieldInput";
import { isFieldRequired } from "@/lib/formRules";

export default function FormRunner({
  form,
  currentMerchandisers,
}: {
  form: FormRecord;
  currentMerchandisers?: { personName: string; code: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const allFields = form.form_sections.flatMap((s) => s.form_fields);
  const merchandiserField = allFields.find((f) => f.label === "Merchandiser Name");
  // A logged-in merchandiser is always exactly one code-holder — their own —
  // never a list of everyone else's names.
  const myIdentity = currentMerchandisers?.[0];
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(() =>
    merchandiserField && myIdentity ? { [merchandiserField.id]: myIdentity.personName } : {}
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function setValue(fieldId: string, value: string | string[]) {
    setAnswers((prev) => ({ ...prev, [fieldId]: value }));
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
          v === undefined ||
          v === "" ||
          (Array.isArray(v) && v.length === 0);
        if (isEmpty) missing.push(field.label);
      }
    }
    if (missing.length > 0) {
      setError(`Please complete: ${missing.join(", ")}`);
      return;
    }

    setSubmitting(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("You must be signed in to submit.");
      setSubmitting(false);
      return;
    }

    // If this form asks for a merchandiser name, stamp the submission with
    // whichever merchandiser code that person currently holds — the code
    // may later change hands, but this submission keeps the code that was
    // actually in effect the day it was made.
    let merchandiserCodeId: string | null = null;
    const merchandiserName = merchandiserField ? answers[merchandiserField.id] : undefined;
    if (typeof merchandiserName === "string" && merchandiserName) {
      const { data: assignment } = await supabase
        .from("merchandiser_assignments")
        .select("merchandiser_code_id")
        .eq("form_id", form.id)
        .eq("person_name", merchandiserName)
        .is("effective_to", null)
        .maybeSingle();
      merchandiserCodeId = assignment?.merchandiser_code_id ?? null;
    }

    const { data: submission, error: subErr } = await supabase
      .from("submissions")
      .insert({
        form_id: form.id,
        submitted_by: user.id,
        merchandiser_code_id: merchandiserCodeId,
      })
      .select("id")
      .single();

    if (subErr || !submission) {
      setError(subErr?.message ?? "Could not create submission.");
      setSubmitting(false);
      return;
    }

    const rows = Object.entries(answers)
      .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : v !== ""))
      .map(([field_id, v]) => ({
        submission_id: submission.id,
        field_id,
        value: Array.isArray(v) ? v.join(", ") : v,
      }));

    if (rows.length > 0) {
      const { error: ansErr } = await supabase
        .from("submission_answers")
        .insert(rows);
      if (ansErr) {
        setError(ansErr.message);
        setSubmitting(false);
        return;
      }
    }

    setSubmitting(false);
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <main className="flex-1 bg-[var(--sand-50)]">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--pine-100)] text-[var(--pine-700)] mb-4">
            ✓
          </div>
          <h1 className="font-display text-2xl text-[var(--ink-900)] mb-2">
            Response recorded
          </h1>
          <p className="text-[var(--ink-600)] mb-8">
            Thanks — your submission for &ldquo;{form.title}&rdquo; has been
            saved.
          </p>
          <button
            type="button"
            onClick={() => {
              setAnswers({});
              setDone(false);
            }}
            className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-5 py-2.5 hover:bg-[var(--pine-900)] transition-colors"
          >
            Submit another response
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Data collection form
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-2">
          {form.title}
        </h1>
        {form.description && (
          <p className="text-[var(--ink-600)] mb-2">{form.description}</p>
        )}
        {myIdentity && (
          <Link
            href={`/forms/${form.id}/merchandiser-code`}
            className="inline-block mb-6 text-sm text-[var(--pine-700)] hover:underline"
          >
            Request a merchandiser code reassignment →
          </Link>
        )}

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
                {section.form_fields.map((field) => {
                  const isMerchandiserField = field.id === merchandiserField?.id && !!myIdentity;
                  return (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-[var(--ink-900)] mb-1.5">
                        {field.label}
                        {isFieldRequired(field, answers, allFields) && (
                          <span className="text-[var(--rust-600)]"> *</span>
                        )}
                      </label>
                      {isMerchandiserField ? (
                        <p className="rounded-md border border-[var(--line)] bg-[var(--sand-50)] px-3 py-2 text-sm text-[var(--ink-900)]">
                          {myIdentity!.personName}
                          <span className="ml-2 text-xs font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 bg-[var(--pine-100)] text-[var(--pine-700)]">
                            {myIdentity!.code}
                          </span>
                        </p>
                      ) : (
                        <FieldInput
                          field={field}
                          value={answers[field.id] ?? (field.field_type === "checkbox" || field.field_type === "multiselect" ? [] : "")}
                          onChange={(v) => setValue(field.id, v)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {error && (
            <p className="text-sm text-[var(--rust-600)]" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-3 hover:bg-[var(--pine-900)] transition-colors disabled:opacity-60"
          >
            {submitting ? "Submitting…" : "Submit response"}
          </button>
        </form>
      </div>
    </main>
  );
}
