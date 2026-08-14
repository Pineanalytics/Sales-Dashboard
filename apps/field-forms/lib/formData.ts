import type { SupabaseClient } from "@supabase/supabase-js";
import type { SubmissionRow } from "./dashboard";

export interface FormFieldMeta {
  id: string;
  label: string;
  field_type: string;
  options: string[] | null;
}

export interface DateRange {
  from?: string; // inclusive, "YYYY-MM-DD"
  to?: string; // inclusive, "YYYY-MM-DD"
}

export async function getFormFieldsAndRows(
  supabase: SupabaseClient,
  formId: string,
  dateRange?: DateRange
): Promise<{
  form: { id: string; title: string } | null;
  fields: FormFieldMeta[];
  rows: SubmissionRow[];
}> {
  const { data: form } = await supabase
    .from("forms")
    .select(
      `id, title,
       form_sections (
         id, order_index,
         form_fields ( id, label, field_type, options, order_index, is_active )
       )`
    )
    .eq("id", formId)
    .single();

  if (!form) return { form: null, fields: [], rows: [] };

  // Archived fields (e.g. a retired/duplicate question) stay in the
  // database for existing submission_answers, but drop out of every
  // dashboard/report computation and export from here.
  const fields = (form as any).form_sections
    .sort((a: any, b: any) => a.order_index - b.order_index)
    .flatMap((s: any) => s.form_fields)
    .filter((f: any) => f.is_active !== false) as FormFieldMeta[];

  let query = supabase
    .from("submissions")
    .select(
      "id, submitted_at, submission_answers ( field_id, value ), merchandiser_codes ( code )"
    )
    .eq("form_id", formId)
    .order("submitted_at", { ascending: false });

  if (dateRange?.from) {
    query = query.gte("submitted_at", `${dateRange.from}T00:00:00.000Z`);
  }
  if (dateRange?.to) {
    query = query.lte("submitted_at", `${dateRange.to}T23:59:59.999Z`);
  }

  const { data: submissions } = await query;

  const rows: SubmissionRow[] = (submissions ?? []).map((s: any) => {
    const answers: Record<string, string> = {};
    for (const a of s.submission_answers) answers[a.field_id] = a.value ?? "";
    return {
      id: s.id,
      submittedAt: s.submitted_at,
      answers,
      merchandiserCode: s.merchandiser_codes?.code ?? null,
    };
  });

  return { form: { id: form.id, title: form.title }, fields, rows };
}

export function byLabel(fields: FormFieldMeta[], label: string) {
  return fields.find((f) => f.label === label);
}
