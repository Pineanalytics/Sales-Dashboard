import type { CoachingTemplateQuestion, CoachingTemplateSection } from "./coachingTypes";
import { performanceBandFor } from "./coachingTypes";

// Converts one answer into a 0-100 percent score. Text/photo questions carry
// no numeric score (qualitative evidence only); "na" answers are excluded
// from the average rather than counted as 0, matching the spec's "Not
// Applicable" semantics.
function answerToPercent(question: CoachingTemplateQuestion, value: string): number | null {
  if (question.question_type === "rating_1_5") {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return ((n - 1) / 4) * 100;
  }
  if (question.question_type === "yes_no_na") {
    const v = value.toLowerCase();
    if (v === "na") return null;
    return v === "yes" ? 100 : 0;
  }
  return null; // text / photo: not scored
}

export interface ScoringResult {
  overallScore: number;
  sectionScores: Record<string, number>;
  band: (typeof import("./coachingTypes").PERFORMANCE_BANDS)[number];
  criticalFailures: string[]; // question ids that failed a critical check
}

/**
 * Computes section and overall scores from every answer given across all of
 * an accompaniment's outlet visits (multiple visits answering the same
 * question set are averaged together first, then rolled up by question
 * weight -> section weight, matching the §10/§11 scorecard spec).
 */
export function computeAccompanimentScore(
  sections: CoachingTemplateSection[],
  questionsBySection: Record<string, CoachingTemplateQuestion[]>,
  answersByQuestionId: Record<string, string[]>
): ScoringResult {
  const sectionScores: Record<string, number> = {};
  const criticalFailures: string[] = [];
  let weightedSectionSum = 0;
  let totalSectionWeight = 0;

  for (const section of sections) {
    const questions = questionsBySection[section.id] ?? [];
    let weightedQuestionSum = 0;
    let totalQuestionWeight = 0;
    let sectionCriticalFailed = false;

    for (const question of questions) {
      const rawAnswers = answersByQuestionId[question.id] ?? [];
      const percents = rawAnswers
        .map((v) => answerToPercent(question, v))
        .filter((p): p is number => p !== null);
      if (percents.length === 0) continue;

      const avgPercent = percents.reduce((a, b) => a + b, 0) / percents.length;
      weightedQuestionSum += avgPercent * question.weight;
      totalQuestionWeight += question.weight;

      if (question.is_critical && avgPercent === 0) {
        sectionCriticalFailed = true;
        criticalFailures.push(question.id);
      }
    }

    if (totalQuestionWeight === 0) continue;
    let sectionScore = weightedQuestionSum / totalQuestionWeight;
    // A failed critical question caps the section in the "Critical
    // Improvement Required" band regardless of how well everything else
    // scored — critical items are meant to be non-negotiable.
    if (sectionCriticalFailed) sectionScore = Math.min(sectionScore, 39);

    sectionScores[section.id] = Math.round(sectionScore * 10) / 10;
    weightedSectionSum += sectionScore * section.weight;
    totalSectionWeight += section.weight;
  }

  const overallScore =
    totalSectionWeight === 0 ? 0 : Math.round((weightedSectionSum / totalSectionWeight) * 10) / 10;

  return {
    overallScore,
    sectionScores,
    band: performanceBandFor(overallScore),
    criticalFailures,
  };
}

// Haversine distance in metres — used for geofence verification against an
// outlet's registered coordinates.
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
