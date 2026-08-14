import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import SubmissionsTable from "./SubmissionsTable";

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form, error: formErr } = await supabase
    .from("forms")
    .select(
      `id, title,
       form_sections (
         id, order_index,
         form_fields ( id, label, field_type, order_index, is_active )
       )`
    )
    .eq("id", id)
    .single();

  if (formErr || !form) notFound();

  // Ordered flat list of fields (columns for the table / CSV) — archived
  // fields are excluded here too, but their answers stay in the database.
  const orderedFields = [...form.form_sections]
    .sort((a: any, b: any) => a.order_index - b.order_index)
    .flatMap((s: any) =>
      [...s.form_fields]
        .filter((f: any) => f.is_active !== false)
        .sort((a: any, b: any) => a.order_index - b.order_index)
    ) as { id: string; label: string; field_type: string }[];

  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      `id, submitted_at, submitted_by,
       profiles ( email, full_name ),
       submission_answers ( field_id, value ),
       merchandiser_codes ( code )`
    )
    .eq("form_id", id)
    .order("submitted_at", { ascending: false });

  const rows = (submissions ?? []).map((sub: any) => {
    const answerMap: Record<string, string> = {};
    for (const a of sub.submission_answers) {
      answerMap[a.field_id] = a.value ?? "";
    }
    return {
      id: sub.id,
      submittedAt: sub.submitted_at,
      submitterEmail: sub.profiles?.email ?? "",
      submitterName: sub.profiles?.full_name ?? "",
      answers: answerMap,
      merchandiserCode: sub.merchandiser_codes?.code ?? null,
    };
  });

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-6">
          <Link
            href="/admin"
            className="text-sm text-[var(--ink-600)] hover:text-[var(--pine-700)]"
          >
            ← Back to forms
          </Link>
        </div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
              Submissions
            </p>
            <h1 className="font-display text-3xl text-[var(--ink-900)]">
              {form.title}
            </h1>
          </div>
        </div>

        <FormAdminNav formId={id} />

        <SubmissionsTable
          formId={id}
          formTitle={form.title}
          fields={orderedFields}
          rows={rows}
        />
      </div>
    </main>
  );
}
