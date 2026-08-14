import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import FormAdminNav from "@/components/FormAdminNav";
import FormBuilder from "../../FormBuilder";

export default async function EditFormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form, error } = await supabase
    .from("forms")
    .select(
      `id, title, description, is_active,
       form_sections (
         id, title, description, order_index,
         form_fields ( id, label, field_type, options, required, placeholder, order_index, is_active )
       )`
    )
    .eq("id", id)
    .single();

  if (error || !form) notFound();

  const sections = [...form.form_sections]
    .sort((a: any, b: any) => a.order_index - b.order_index)
    .map((s: any) => ({
      tempId: s.id,
      title: s.title,
      description: s.description ?? "",
      // Archived fields are left out of the builder entirely — they're
      // done being edited, just retained in the database for their answers.
      fields: [...s.form_fields]
        .filter((f: any) => f.is_active !== false)
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .map((f: any) => ({
          tempId: f.id,
          label: f.label,
          field_type: f.field_type,
          optionsText: (f.options ?? []).join(", "),
          required: f.required,
          placeholder: f.placeholder ?? "",
        })),
    }));

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-3xl mx-auto px-6 pt-8">
        <FormAdminNav formId={id} />
      </div>
      <FormBuilder
        formId={form.id}
        initialTitle={form.title}
        initialDescription={form.description ?? ""}
        initialIsActive={form.is_active}
        initialSections={sections}
      />
    </main>
  );
}
