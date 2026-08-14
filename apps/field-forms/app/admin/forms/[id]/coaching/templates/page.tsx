import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  CoachingTemplate,
  CoachingTemplateSection,
  CoachingTemplateQuestion,
} from "@/lib/coachingTypes";
import TemplatesManager from "./TemplatesManager";

export default async function TemplatesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: form } = await supabase.from("forms").select("id, title").eq("id", id).single();
  if (!form) notFound();

  const { data: templates } = await supabase
    .from("coaching_templates")
    .select("*")
    .eq("form_id", id)
    .order("version", { ascending: false });

  const templateIds = (templates ?? []).map((t) => t.id);
  const { data: sections } = templateIds.length
    ? await supabase
        .from("coaching_template_sections")
        .select("*")
        .in("template_id", templateIds)
        .order("order_index")
    : { data: [] };

  const sectionIds = (sections ?? []).map((s) => s.id);
  const { data: questions } = sectionIds.length
    ? await supabase
        .from("coaching_template_questions")
        .select("*")
        .in("section_id", sectionIds)
        .order("order_index")
    : { data: [] };

  return (
    <main className="flex-1 bg-[var(--sand-50)]">
      <div className="max-w-5xl mx-auto px-6 pb-16">
        <p className="font-mono-label text-xs uppercase tracking-wider text-[var(--pine-600)] mb-2">
          Coaching system
        </p>
        <h1 className="font-display text-3xl text-[var(--ink-900)] mb-6">Coaching Templates</h1>

        <TemplatesManager
          formId={id}
          initialTemplates={(templates ?? []) as CoachingTemplate[]}
          initialSections={(sections ?? []) as CoachingTemplateSection[]}
          initialQuestions={(questions ?? []) as CoachingTemplateQuestion[]}
        />
      </div>
    </main>
  );
}
