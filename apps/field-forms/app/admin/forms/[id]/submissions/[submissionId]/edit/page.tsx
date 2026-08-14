import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { FormRecord } from "@/lib/types";
import EditSubmissionForm from "./EditSubmissionForm";

export default async function EditSubmissionPage({
  params,
}: {
  params: Promise<{ id: string; submissionId: string }>;
}) {
  const { id, submissionId } = await params;
  const supabase = await createClient();

  const { data: form, error } = await supabase
    .from("forms")
    .select(
      `id, title, description, is_active,
       form_sections (
         id, title, description, order_index,
         form_fields ( id, label, field_type, options, required, placeholder, order_index )
       )`
    )
    .eq("id", id)
    .single();

  if (error || !form) notFound();

  const typedForm = form as unknown as FormRecord;
  typedForm.form_sections = [...typedForm.form_sections]
    .sort((a, b) => a.order_index - b.order_index)
    .map((s) => ({
      ...s,
      form_fields: [...s.form_fields].sort(
        (a, b) => a.order_index - b.order_index
      ),
    }));

  const { data: submission, error: subErr } = await supabase
    .from("submissions")
    .select("id, form_id, submitted_at, profiles ( email, full_name )")
    .eq("id", submissionId)
    .eq("form_id", id)
    .single();

  if (subErr || !submission) notFound();

  const { data: answerRows } = await supabase
    .from("submission_answers")
    .select("field_id, value")
    .eq("submission_id", submissionId);

  const arrayFieldTypes = new Set(["multiselect", "checkbox"]);
  const fieldTypeById = new Map<string, string>();
  for (const s of typedForm.form_sections) {
    for (const f of s.form_fields) fieldTypeById.set(f.id, f.field_type);
  }

  const initialAnswers: Record<string, string | string[]> = {};
  for (const row of answerRows ?? []) {
    const type = fieldTypeById.get(row.field_id);
    if (type && arrayFieldTypes.has(type)) {
      initialAnswers[row.field_id] = row.value
        ? row.value.split(", ").filter(Boolean)
        : [];
    } else {
      initialAnswers[row.field_id] = row.value ?? "";
    }
  }

  const submitter =
    (submission as any).profiles?.full_name ||
    (submission as any).profiles?.email ||
    "unknown user";

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="mb-6">
          <Link
            href={`/admin/forms/${id}/submissions`}
            className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
          >
            ← Back to submissions
          </Link>
        </div>
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Editing submission
        </p>
        <h1 className="font-display text-2xl text-[var(--ink-900)] mb-1">
          {typedForm.title}
        </h1>
        <p className="text-sm text-[var(--ink-600)] mb-8">
          Submitted by {submitter} on{" "}
          {new Date(submission.submitted_at).toLocaleString()}
        </p>

        <EditSubmissionForm
          form={typedForm}
          submissionId={submissionId}
          initialAnswers={initialAnswers}
        />
      </div>
    </main>
  );
}
