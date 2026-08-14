import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { FormRecord } from "@/lib/types";
import FormRunner from "./FormRunner";

export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

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

  const typedForm = form as unknown as FormRecord;
  typedForm.form_sections = [...typedForm.form_sections]
    .sort((a, b) => a.order_index - b.order_index)
    .map((s) => ({
      ...s,
      form_fields: [...s.form_fields]
        .filter((f: any) => f.is_active !== false)
        .sort((a, b) => a.order_index - b.order_index),
    }));

  // Tenants using the merchandiser-code system gate submission on having an
  // approved code assignment — the logged-in account's own code+name is the
  // only identity offered, never a pick-anyone-else list.
  const { count: codeSystemCount } = await supabase
    .from("merchandiser_codes")
    .select("id", { count: "exact", head: true })
    .eq("form_id", id);

  let currentMerchandisers: { personName: string; code: string }[] = [];

  if (codeSystemCount && codeSystemCount > 0) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role === "user") {
      const { data: myCode } = await supabase
        .from("merchandiser_codes")
        .select("id, code")
        .eq("form_id", id)
        .eq("email", user.email)
        .maybeSingle();

      const { data: myAssignment } = myCode
        ? await supabase
            .from("merchandiser_assignments")
            .select("person_name")
            .eq("merchandiser_code_id", myCode.id)
            .is("effective_to", null)
            .maybeSingle()
        : { data: null };

      if (!myAssignment) {
        return (
          <main className="flex-1 bg-[var(--sand-50)]">
            <div className="max-w-md mx-auto px-6 py-20 text-center">
              <h1 className="font-display text-2xl text-[var(--ink-900)] mb-2">
                No code assigned yet
              </h1>
              <p className="text-[var(--ink-600)] mb-6">
                You can't submit visits until a supervisor assigns you a
                merchandiser code.
              </p>
              <Link
                href={`/forms/${id}/merchandiser-code`}
                className="text-sm text-[var(--pine-700)] hover:underline"
              >
                Request a code →
              </Link>
            </div>
          </main>
        );
      }

      currentMerchandisers = [{ personName: myAssignment.person_name, code: myCode!.code }];
    }
  }

  return <FormRunner form={typedForm} currentMerchandisers={currentMerchandisers} />;
}
