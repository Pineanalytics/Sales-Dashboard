"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type {
  CoachingTemplate,
  CoachingTemplateSection,
  CoachingTemplateQuestion,
  QuestionType,
} from "@/lib/coachingTypes";
import { QUESTION_TYPES } from "@/lib/coachingTypes";

export default function TemplatesManager({
  formId,
  initialTemplates,
  initialSections,
  initialQuestions,
}: {
  formId: string;
  initialTemplates: CoachingTemplate[];
  initialSections: CoachingTemplateSection[];
  initialQuestions: CoachingTemplateQuestion[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(initialTemplates[0]?.id ?? null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [busy, setBusy] = useState(false);

  const sectionsOf = (templateId: string) =>
    initialSections.filter((s) => s.template_id === templateId);
  const questionsOf = (sectionId: string) =>
    initialQuestions.filter((q) => q.section_id === sectionId);

  async function addTemplate() {
    if (!newTemplateName.trim()) return;
    setBusy(true);
    const nextVersion =
      Math.max(0, ...initialTemplates.map((t) => t.version)) + 1;
    await supabase.from("coaching_templates").insert({
      form_id: formId,
      name: newTemplateName.trim(),
      version: nextVersion,
    });
    setBusy(false);
    setNewTemplateName("");
    router.refresh();
  }

  async function addSection(templateId: string, title: string) {
    if (!title.trim()) return;
    const order = sectionsOf(templateId).length;
    await supabase
      .from("coaching_template_sections")
      .insert({ template_id: templateId, title: title.trim(), order_index: order });
    router.refresh();
  }

  async function updateSectionWeight(section: CoachingTemplateSection, weight: number) {
    await supabase.from("coaching_template_sections").update({ weight }).eq("id", section.id);
    router.refresh();
  }

  async function addQuestion(sectionId: string, prompt: string) {
    if (!prompt.trim()) return;
    const order = questionsOf(sectionId).length;
    await supabase.from("coaching_template_questions").insert({
      section_id: sectionId,
      prompt: prompt.trim(),
      question_type: "rating_1_5",
      order_index: order,
    });
    router.refresh();
  }

  async function updateQuestion(
    question: CoachingTemplateQuestion,
    patch: Partial<CoachingTemplateQuestion>
  ) {
    await supabase.from("coaching_template_questions").update(patch).eq("id", question.id);
    router.refresh();
  }

  return (
    <div>
      <div className="flex gap-2 mb-6">
        <input
          value={newTemplateName}
          onChange={(e) => setNewTemplateName(e.target.value)}
          placeholder="New template name (e.g. FMCG Field Excellence Scorecard v2)"
          className="flex-1 rounded-md border border-[var(--line)] px-3 py-2 text-sm"
        />
        <button
          disabled={busy}
          onClick={addTemplate}
          className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-50"
        >
          + New template version
        </button>
      </div>

      <div className="space-y-4">
        {initialTemplates.map((t) => (
          <div key={t.id} className="bg-white border border-[var(--line)] rounded-lg p-4">
            <button
              onClick={() => setExpanded(expanded === t.id ? null : t.id)}
              className="w-full flex items-center justify-between text-left"
            >
              <span className="font-display text-lg text-[var(--ink-900)]">
                {t.name} <span className="text-sm text-[var(--ink-400)]">v{t.version}</span>
              </span>
              <span className="text-xs text-[var(--ink-400)]">
                {t.is_active ? "Active" : "Inactive"} · {expanded === t.id ? "▾" : "▸"}
              </span>
            </button>

            {expanded === t.id && (
              <div className="mt-4 space-y-4">
                {sectionsOf(t.id).map((section) => (
                  <SectionBlock
                    key={section.id}
                    section={section}
                    questions={questionsOf(section.id)}
                    onWeightChange={(w) => updateSectionWeight(section, w)}
                    onAddQuestion={(prompt) => addQuestion(section.id, prompt)}
                    onUpdateQuestion={updateQuestion}
                  />
                ))}
                <AddSectionRow onAdd={(title) => addSection(t.id, title)} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AddSectionRow({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState("");
  return (
    <div className="flex gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="New section title"
        className="flex-1 rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
      />
      <button
        onClick={() => {
          onAdd(title);
          setTitle("");
        }}
        className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-1.5 hover:border-[var(--pine-500)]"
      >
        + Add section
      </button>
    </div>
  );
}

function SectionBlock({
  section,
  questions,
  onWeightChange,
  onAddQuestion,
  onUpdateQuestion,
}: {
  section: CoachingTemplateSection;
  questions: CoachingTemplateQuestion[];
  onWeightChange: (weight: number) => void;
  onAddQuestion: (prompt: string) => void;
  onUpdateQuestion: (question: CoachingTemplateQuestion, patch: Partial<CoachingTemplateQuestion>) => void;
}) {
  const [newPrompt, setNewPrompt] = useState("");
  return (
    <div className="border border-[var(--line)] rounded-md p-3 bg-[var(--sand-50)]">
      <div className="flex items-center justify-between mb-2">
        <p className="font-medium text-[var(--ink-900)]">{section.title}</p>
        <label className="flex items-center gap-1.5 text-xs text-[var(--ink-600)]">
          Weight
          <input
            type="number"
            step="0.1"
            defaultValue={section.weight}
            onBlur={(e) => onWeightChange(Number(e.target.value))}
            className="w-16 rounded border border-[var(--line)] px-1.5 py-0.5"
          />
        </label>
      </div>
      <ul className="space-y-2">
        {questions.map((q) => (
          <li key={q.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex-1 min-w-[200px]">{q.prompt}</span>
            <select
              defaultValue={q.question_type}
              onChange={(e) => onUpdateQuestion(q, { question_type: e.target.value as QuestionType })}
              className="rounded border border-[var(--line)] px-1.5 py-0.5 text-xs"
            >
              {QUESTION_TYPES.map((qt) => (
                <option key={qt} value={qt}>
                  {qt}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-[var(--ink-600)]">
              <input
                type="checkbox"
                defaultChecked={q.is_mandatory}
                onChange={(e) => onUpdateQuestion(q, { is_mandatory: e.target.checked })}
                className="accent-[var(--pine-600)]"
              />
              Mandatory
            </label>
            <label className="flex items-center gap-1 text-xs text-[var(--ink-600)]">
              <input
                type="checkbox"
                defaultChecked={q.is_critical}
                onChange={(e) => onUpdateQuestion(q, { is_critical: e.target.checked })}
                className="accent-[var(--rust-600)]"
              />
              Critical
            </label>
          </li>
        ))}
      </ul>
      <div className="flex gap-2 mt-3">
        <input
          value={newPrompt}
          onChange={(e) => setNewPrompt(e.target.value)}
          placeholder="New question prompt"
          className="flex-1 rounded border border-[var(--line)] px-2 py-1 text-xs"
        />
        <button
          onClick={() => {
            onAddQuestion(newPrompt);
            setNewPrompt("");
          }}
          className="rounded border border-[var(--line)] text-xs font-medium px-2 py-1 hover:border-[var(--pine-500)]"
        >
          + Add question
        </button>
      </div>
    </div>
  );
}
