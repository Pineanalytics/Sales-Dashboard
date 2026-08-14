"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { computeAccompanimentScore, haversineDistanceMeters } from "@/lib/coachingScoring";
import { notifyUser } from "@/lib/notify";
import type {
  CoachingAccompaniment,
  CoachingActionPlan,
  CoachingOutletVisit,
  CoachingPhoto,
  CoachingSelfEvaluation,
  CoachingTemplateQuestion,
  CoachingTemplateSection,
  CoachingVisitAnswer,
  GeofenceStatus,
} from "@/lib/coachingTypes";

// Wraps navigator.geolocation in a promise and gives a plain-English reason
// for failure — used both to gate starting a visit and to gate every photo
// capture, since Location must stay enabled for the whole survey, not just
// at arrival.
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This device/browser doesn't support location services."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        reject(new Error("Location permission is off. Enable Location for this browser/app and try again."));
      } else {
        reject(new Error("Could not get a GPS fix. Move to an open area and try again."));
      }
    }, { enableHighAccuracy: true, timeout: 15000 });
  });
}
import { ACTION_PRIORITIES } from "@/lib/coachingTypes";

interface SectionWithQuestions extends CoachingTemplateSection {
  coaching_template_questions: CoachingTemplateQuestion[];
}
interface OutletOption {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number;
}

const GEOFENCE_LABEL: Record<GeofenceStatus, string> = {
  inside: "Inside geofence",
  outside: "Outside geofence",
  gps_unavailable: "GPS unavailable",
};
const GEOFENCE_COLOR: Record<GeofenceStatus, string> = {
  inside: "text-[var(--pine-700)] bg-[var(--pine-100)]",
  outside: "text-[var(--rust-600)] bg-[var(--rust-600)]/10",
  gps_unavailable: "text-[var(--ink-600)] bg-[var(--sand-100)]",
};

export default function AccompanimentWorkspace({
  formId,
  accompaniment,
  sections,
  outlets,
  initialVisits,
  initialAnswers,
  initialActionPlans,
  initialSelfEval,
  initialPhotos,
  salesRepId,
}: {
  formId: string;
  accompaniment: CoachingAccompaniment;
  sections: SectionWithQuestions[];
  outlets: OutletOption[];
  initialVisits: CoachingOutletVisit[];
  initialAnswers: CoachingVisitAnswer[];
  initialActionPlans: CoachingActionPlan[];
  initialSelfEval: CoachingSelfEvaluation | null;
  initialPhotos: CoachingPhoto[];
  salesRepId: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const readOnly = accompaniment.status !== "draft";

  const [visits, setVisits] = useState<CoachingOutletVisit[]>(initialVisits);
  const [answers, setAnswers] = useState<CoachingVisitAnswer[]>(initialAnswers);
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [outletSearch, setOutletSearch] = useState("");
  // Route-scoped outlets (the `outlets` prop) are just today's quick-pick
  // suggestions — routes can have anywhere from one outlet to hundreds, so
  // restricting visit selection to only that list made it look like there
  // was nobody else to visit once a route was thin. Any outlet in the
  // tenant is a valid stop ("outlets are free fall" — any rep/coach/
  // supervisor can visit any of them), so typing a search queries the full
  // outlet set live instead of just filtering the route's short list.
  const [searchResults, setSearchResults] = useState<OutletOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [allOutletsById, setAllOutletsById] = useState<Record<string, OutletOption>>(
    Object.fromEntries(outlets.map((o) => [o.id, o]))
  );
  const filteredOutlets = outletSearch.trim() ? searchResults : outlets;
  const [selectedOutletId, setSelectedOutletId] = useState(outlets[0]?.id ?? "");
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CoachingPhoto[]>(initialPhotos);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const [actionPlans, setActionPlans] = useState<CoachingActionPlan[]>(initialActionPlans);
  const [selfEval, setSelfEval] = useState<Partial<CoachingSelfEvaluation>>(initialSelfEval ?? {});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const term = outletSearch.trim();
    if (!term) {
      setSearchResults([]);
      if (!outlets.some((o) => o.id === selectedOutletId)) {
        setSelectedOutletId(outlets[0]?.id ?? "");
      }
      return;
    }
    setSearching(true);
    const timeout = setTimeout(async () => {
      const { data } = await supabase
        .from("coaching_outlets")
        .select("id, name, address, latitude, longitude, geofence_radius_m")
        .eq("form_id", formId)
        .eq("is_active", true)
        .ilike("name", `%${term}%`)
        .order("name")
        .limit(25);
      const results = (data ?? []) as OutletOption[];
      setSearchResults(results);
      setAllOutletsById((prev) => ({ ...prev, ...Object.fromEntries(results.map((o) => [o.id, o])) }));
      setSelectedOutletId(results[0]?.id ?? "");
      setSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outletSearch]);

  const answerFor = (outletVisitId: string, questionId: string) =>
    answers.find((a) => a.outlet_visit_id === outletVisitId && a.question_id === questionId);

  async function startVisit() {
    if (!selectedOutletId) {
      setError("Select an outlet first, or search to find one outside today's route.");
      return;
    }
    setCapturing(true);
    setError(null);
    const outlet = allOutletsById[selectedOutletId];
    if (!outlet) {
      setCapturing(false);
      setError("That outlet couldn't be found — try searching again.");
      return;
    }

    // Location must be on for the whole survey, not optional — a visit with
    // no verified GPS position isn't proof anyone actually went to the
    // outlet, so we refuse to start rather than falling back to null coords.
    let pos: GeolocationPosition;
    try {
      pos = await getPosition();
    } catch (e) {
      setCapturing(false);
      setError((e as Error).message);
      return;
    }
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const accuracy = pos.coords.accuracy;

    let distance: number | null = null;
    let status: GeofenceStatus = "gps_unavailable";
    if (outlet.latitude != null && outlet.longitude != null) {
      distance = Math.round(haversineDistanceMeters(lat, lng, outlet.latitude, outlet.longitude));
      status = distance <= outlet.geofence_radius_m ? "inside" : "outside";
    }
    const { data, error: err } = await supabase
      .from("coaching_outlet_visits")
      .insert({
        accompaniment_id: accompaniment.id,
        outlet_id: outlet.id,
        arrival_at: new Date().toISOString(),
        latitude: lat,
        longitude: lng,
        gps_accuracy_m: accuracy,
        distance_from_outlet_m: distance,
        geofence_status: status,
      })
      .select("*")
      .single();
    setCapturing(false);
    if (err) {
      setError(err.message);
      return;
    }
    setVisits((prev) => [...prev, data as CoachingOutletVisit]);
    setActiveVisitId(data!.id);
    // Clear the outlet search so the picker goes back to showing every
    // outlet, ready to pick the next customer — otherwise whatever was
    // typed to find this outlet keeps filtering the list afterward, making
    // it look like no other outlets exist.
    setOutletSearch("");
  }

  async function saveAnswer(outletVisitId: string, question: CoachingTemplateQuestion, value: string) {
    const existing = answerFor(outletVisitId, question.id);
    if (existing) {
      await supabase.from("coaching_visit_answers").update({ answer_value: value }).eq("id", existing.id);
      setAnswers((prev) =>
        prev.map((a) => (a.id === existing.id ? { ...a, answer_value: value } : a))
      );
    } else {
      const { data } = await supabase
        .from("coaching_visit_answers")
        .insert({ outlet_visit_id: outletVisitId, question_id: question.id, answer_value: value })
        .select("*")
        .single();
      if (data) setAnswers((prev) => [...prev, data as CoachingVisitAnswer]);
    }
  }

  async function saveNotes(visitId: string, notes: string) {
    await supabase.from("coaching_outlet_visits").update({ notes }).eq("id", visitId);
    setVisits((prev) => prev.map((v) => (v.id === visitId ? { ...v, notes } : v)));
  }

  async function finishVisit(visitId: string) {
    await supabase
      .from("coaching_outlet_visits")
      .update({ departure_at: new Date().toISOString() })
      .eq("id", visitId);
    setVisits((prev) =>
      prev.map((v) => (v.id === visitId ? { ...v, departure_at: new Date().toISOString() } : v))
    );
    setActiveVisitId(null);
  }

  async function uploadPhoto(visitId: string, outletId: string, file: File) {
    setError(null);
    // Fastened to the shot itself, not just visit-arrival — GPS + timestamp
    // are captured at the moment of upload and become the outlet's real
    // coordinate going forward (coaching_outlets.latitude/longitude gets
    // corrected below), so the map reflects where the shop actually is.
    let pos: GeolocationPosition;
    try {
      pos = await getPosition();
    } catch (e) {
      setError(`Photo not saved — ${(e as Error).message}`);
      return;
    }
    setUploadingPhoto(true);
    const path = `${accompaniment.id}/${visitId}/${crypto.randomUUID()}.${file.name.split(".").pop() || "jpg"}`;
    const { error: upErr } = await supabase.storage.from("coaching-photos").upload(path, file);
    if (upErr) {
      setUploadingPhoto(false);
      setError(upErr.message);
      return;
    }
    const { data } = supabase.storage.from("coaching-photos").getPublicUrl(path);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const takenAt = new Date().toISOString();
    const { data: photo, error: insErr } = await supabase
      .from("coaching_photos")
      .insert({
        accompaniment_id: accompaniment.id,
        outlet_visit_id: visitId,
        storage_url: data.publicUrl,
        uploaded_by: user?.id,
        taken_at: takenAt,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        gps_accuracy_m: pos.coords.accuracy,
      })
      .select("*")
      .single();
    setUploadingPhoto(false);
    if (insErr) {
      setError(insErr.message);
      return;
    }
    setPhotos((prev) => [...prev, photo as CoachingPhoto]);

    // The photo's GPS is the actual, field-verified location of the shop —
    // correct the outlet's stored coordinate to it so the map improves with
    // every real visit instead of relying on whatever was loaded at setup.
    await supabase
      .from("coaching_outlets")
      .update({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
      .eq("id", outletId);
  }

  const [newAction, setNewAction] = useState({
    issue: "",
    coaching_area: sections[0]?.title ?? "",
    required_action: "",
    target_date: "",
    priority: "medium" as (typeof ACTION_PRIORITIES)[number],
  });
  async function addActionPlan() {
    setError(null);
    if (!newAction.issue.trim() || !newAction.required_action.trim()) {
      setError("Fill in both \"Issue identified\" and \"Required action\" before adding.");
      return;
    }
    const { data, error: err } = await supabase
      .from("coaching_action_plans")
      .insert({
        accompaniment_id: accompaniment.id,
        issue: newAction.issue,
        coaching_area: newAction.coaching_area,
        required_action: newAction.required_action,
        owner_id: salesRepId,
        target_date: newAction.target_date || null,
        priority: newAction.priority,
      })
      .select("*")
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    if (data) {
      setActionPlans((prev) => [...prev, data as CoachingActionPlan]);
      setNewAction({ issue: "", coaching_area: sections[0]?.title ?? "", required_action: "", target_date: "", priority: "medium" });
    }
  }

  async function saveSelfEval(field: keyof CoachingSelfEvaluation, value: string) {
    const next = { ...selfEval, [field]: value };
    setSelfEval(next);
    if (initialSelfEval) {
      await supabase.from("coaching_self_evaluations").update({ [field]: value }).eq("id", initialSelfEval.id);
    } else {
      const { data } = await supabase
        .from("coaching_self_evaluations")
        .upsert(
          { accompaniment_id: accompaniment.id, sales_rep_id: salesRepId, ...next },
          { onConflict: "accompaniment_id" }
        )
        .select("*")
        .single();
      if (data) setSelfEval(data);
    }
  }

  const canSubmit = visits.some((v) => v.arrival_at && v.departure_at);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const visitIds = visits.map((v) => v.id);
    const { data: freshAnswers } = visitIds.length
      ? await supabase.from("coaching_visit_answers").select("*").in("outlet_visit_id", visitIds)
      : { data: [] };

    const answersByQuestionId: Record<string, string[]> = {};
    for (const a of freshAnswers ?? []) {
      if (!a.answer_value) continue;
      (answersByQuestionId[a.question_id] ??= []).push(a.answer_value);
    }
    const questionsBySection: Record<string, CoachingTemplateQuestion[]> = {};
    for (const s of sections) questionsBySection[s.id] = s.coaching_template_questions;

    const result = computeAccompanimentScore(sections, questionsBySection, answersByQuestionId);

    const { error: err } = await supabase
      .from("coaching_accompaniments")
      .update({ status: "submitted", overall_score: result.overallScore, end_time: new Date().toISOString() })
      .eq("id", accompaniment.id);
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }

    const { data: teamLeader } = await supabase
      .from("profiles")
      .select("manager_id, full_name")
      .eq("id", accompaniment.team_leader_id)
      .single();
    if (teamLeader?.manager_id) {
      await notifyUser(
        supabase,
        teamLeader.manager_id,
        "coaching_review_required",
        `${teamLeader.full_name ?? "A Team Leader"} submitted an accompaniment (${result.overallScore}%) awaiting your review.`
      );
    }

    router.push(`/forms/${formId}/coaching`);
  }

  const activeVisit = visits.find((v) => v.id === activeVisitId);
  const activeOutlet = activeVisit ? allOutletsById[activeVisit.outlet_id] : null;

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-[var(--rust-600)]">{error}</p>}
      {readOnly && (
        <p className="text-sm bg-[var(--sand-100)] rounded-md px-3 py-2 text-[var(--ink-600)]">
          This accompaniment is {accompaniment.status.replace(/_/g, " ")} and can no longer be edited here.
        </p>
      )}

      <p className="text-xs text-[var(--ink-400)]">
        Start time: {accompaniment.start_time ? new Date(accompaniment.start_time).toLocaleString() : "—"}
        {" · "}
        End time: {accompaniment.end_time ? new Date(accompaniment.end_time).toLocaleString() : "—"}
      </p>

      {/* Outlet visits */}
      <section>
        <h2 className="font-display text-xl text-[var(--ink-900)] mb-3">Outlet visits</h2>
        <div className="space-y-2 mb-4">
          {visits.map((v) => {
            const outlet = allOutletsById[v.outlet_id];
            return (
              <div key={v.id} className="bg-white border border-[var(--line)] rounded-md p-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="font-medium text-[var(--ink-900)]">{outlet?.name}</p>
                    <p className="text-xs text-[var(--ink-400)]">
                      Arrived {v.arrival_at ? new Date(v.arrival_at).toLocaleTimeString() : "—"}
                      {v.departure_at && ` · Departed ${new Date(v.departure_at).toLocaleTimeString()}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {v.geofence_status && (
                      <span className={`text-xs rounded-full px-2 py-0.5 ${GEOFENCE_COLOR[v.geofence_status]}`}>
                        {GEOFENCE_LABEL[v.geofence_status]}
                        {v.distance_from_outlet_m != null ? ` (${v.distance_from_outlet_m}m)` : ""}
                      </span>
                    )}
                    {!readOnly && (
                      <button
                        onClick={() => setActiveVisitId(activeVisitId === v.id ? null : v.id)}
                        className="text-sm text-[var(--pine-700)] hover:underline"
                      >
                        {activeVisitId === v.id ? "Close" : v.departure_at ? "Review" : "Score this outlet"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {!readOnly && (
          <div className="space-y-2">
            {outlets.length === 0 && !outletSearch.trim() && (
              <p className="text-sm text-[var(--ink-500)]">
                No outlets assigned to today&apos;s route yet — search below to find any outlet to visit.
              </p>
            )}
            <input
              type="text"
              value={outletSearch}
              onChange={(e) => setOutletSearch(e.target.value)}
              placeholder="Search any outlet by name — not limited to today's route..."
              className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <select
                value={selectedOutletId}
                onChange={(e) => setSelectedOutletId(e.target.value)}
                disabled={filteredOutlets.length === 0}
                className="flex-1 rounded-md border border-[var(--line)] px-3 py-2 text-sm disabled:opacity-50"
              >
                {filteredOutlets.length === 0 && (
                  <option value="">
                    {searching ? "Searching..." : outletSearch.trim() ? "No matching outlets" : "No outlets on today's route"}
                  </option>
                )}
                {filteredOutlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <button
                disabled={capturing || !selectedOutletId}
                onClick={startVisit}
                className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-50"
              >
                {capturing ? "Capturing GPS..." : "+ Start outlet visit"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Active scorecard */}
      {activeVisit && activeOutlet && (
        <section className="bg-white border border-[var(--line)] rounded-lg p-5">
          <h3 className="font-display text-lg text-[var(--ink-900)] mb-4">
            Scorecard — {activeOutlet.name}
          </h3>
          <div className="space-y-6">
            {sections.map((section) => (
              <div key={section.id}>
                <p className="font-medium text-[var(--ink-900)] mb-2">{section.title}</p>
                <div className="space-y-3">
                  {section.coaching_template_questions.map((q) => {
                    const existing = answerFor(activeVisit.id, q.id);
                    return (
                      <div key={q.id} className="flex flex-wrap items-center gap-3 text-sm">
                        <span className="flex-1 min-w-[200px]">{q.prompt}</span>
                        {q.question_type === "rating_1_5" && (
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                disabled={readOnly}
                                onClick={() => saveAnswer(activeVisit.id, q, String(n))}
                                className={`w-8 h-8 rounded-md border text-xs font-medium ${
                                  existing?.answer_value === String(n)
                                    ? "bg-[var(--pine-700)] text-white border-[var(--pine-700)]"
                                    : "border-[var(--line)] hover:border-[var(--pine-500)]"
                                }`}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        )}
                        {q.question_type === "yes_no_na" && (
                          <div className="flex gap-1">
                            {["yes", "no", "na"].map((v) => (
                              <button
                                key={v}
                                disabled={readOnly}
                                onClick={() => saveAnswer(activeVisit.id, q, v)}
                                className={`rounded-md border text-xs font-medium px-2 py-1 ${
                                  existing?.answer_value === v
                                    ? "bg-[var(--pine-700)] text-white border-[var(--pine-700)]"
                                    : "border-[var(--line)] hover:border-[var(--pine-500)]"
                                }`}
                              >
                                {v.toUpperCase()}
                              </button>
                            ))}
                          </div>
                        )}
                        {(q.question_type === "text" || q.question_type === "photo") && (
                          <input
                            disabled={readOnly}
                            defaultValue={existing?.answer_value ?? ""}
                            onBlur={(e) => saveAnswer(activeVisit.id, q, e.target.value)}
                            className="flex-1 min-w-[160px] rounded-md border border-[var(--line)] px-2 py-1"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            <div>
              <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
                Notes
              </label>
              <textarea
                disabled={readOnly}
                defaultValue={activeVisit.notes ?? ""}
                onBlur={(e) => saveNotes(activeVisit.id, e.target.value)}
                rows={3}
                className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm"
              />
            </div>

            {(() => {
              const visitPhotoCount = photos.filter((p) => p.outlet_visit_id === activeVisit.id).length;
              return (
                <div>
                  {!readOnly && (
                    <label className="inline-block rounded-md border border-[var(--line)] text-sm font-medium px-3 py-2 hover:border-[var(--pine-500)] cursor-pointer">
                      {uploadingPhoto ? "Capturing GPS + uploading..." : "+ Add photo"}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        disabled={uploadingPhoto}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) uploadPhoto(activeVisit.id, activeVisit.outlet_id, file);
                        }}
                      />
                    </label>
                  )}
                  <p className="text-xs text-[var(--ink-400)] mt-1">
                    {visitPhotoCount} photo{visitPhotoCount === 1 ? "" : "s"} captured — a shelf/outlet
                    photo is required to finish this visit. Each photo is GPS- and time-stamped.
                  </p>

                  {!readOnly && !activeVisit.departure_at && (
                    <button
                      disabled={visitPhotoCount === 0}
                      onClick={() => finishVisit(activeVisit.id)}
                      className="w-full mt-3 rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-2.5 hover:bg-[var(--pine-900)] disabled:opacity-50"
                    >
                      Finish this outlet visit
                    </button>
                  )}
                  {!readOnly && !activeVisit.departure_at && visitPhotoCount === 0 && (
                    <p className="text-xs text-[var(--rust-600)] mt-1 text-center">
                      Add at least one photo before finishing this visit.
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </section>
      )}

      {/* Action items */}
      <section>
        <h2 className="font-display text-xl text-[var(--ink-900)] mb-3">Action items</h2>
        <div className="space-y-2 mb-4">
          {actionPlans.map((a) => (
            <div key={a.id} className="bg-white border border-[var(--line)] rounded-md p-3 text-sm">
              <p className="text-[var(--ink-900)]">{a.issue}</p>
              <p className="text-xs text-[var(--ink-400)] mt-0.5">
                {a.coaching_area} · Due {a.target_date ?? "—"} · {a.priority} priority
              </p>
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="bg-white border border-[var(--line)] rounded-md p-3 space-y-2">
            <input
              value={newAction.issue}
              onChange={(e) => setNewAction((p) => ({ ...p, issue: e.target.value }))}
              placeholder="Issue identified"
              className="w-full rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
            />
            <input
              value={newAction.required_action}
              onChange={(e) => setNewAction((p) => ({ ...p, required_action: e.target.value }))}
              placeholder="Required action"
              className="w-full rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={newAction.coaching_area}
                onChange={(e) => setNewAction((p) => ({ ...p, coaching_area: e.target.value }))}
                className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.title}>
                    {s.title}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={newAction.target_date}
                onChange={(e) => setNewAction((p) => ({ ...p, target_date: e.target.value }))}
                className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
              />
              <select
                value={newAction.priority}
                onChange={(e) =>
                  setNewAction((p) => ({ ...p, priority: e.target.value as (typeof ACTION_PRIORITIES)[number] }))
                }
                className="rounded-md border border-[var(--line)] px-2 py-1.5 text-sm"
              >
                {ACTION_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                onClick={addActionPlan}
                className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-1.5 hover:border-[var(--pine-500)]"
              >
                + Add action
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Self-evaluation */}
      <section>
        <h2 className="font-display text-xl text-[var(--ink-900)] mb-3">Sales Rep self-evaluation</h2>
        <div className="bg-white border border-[var(--line)] rounded-md p-4 space-y-3">
          {(
            [
              ["went_well", "What went well?"],
              ["biggest_challenge", "What was the biggest challenge?"],
              ["missed_opportunity", "Which customer opportunity was missed?"],
              ["would_do_differently", "What would you do differently?"],
              ["support_needed", "What support do you need?"],
              ["main_learning", "What is your main learning from today?"],
            ] as [keyof CoachingSelfEvaluation, string][]
          ).map(([field, label]) => (
            <div key={field}>
              <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
                {label}
              </label>
              <textarea
                disabled={readOnly}
                defaultValue={(selfEval[field] as string) ?? ""}
                onBlur={(e) => saveSelfEval(field, e.target.value)}
                rows={2}
                className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </section>

      {!readOnly && (
        <button
          disabled={!canSubmit || submitting}
          onClick={submit}
          className="w-full rounded-md bg-[var(--pine-700)] text-white text-base font-medium py-3 hover:bg-[var(--pine-900)] disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Accompaniment"}
        </button>
      )}
      {!canSubmit && !readOnly && (
        <p className="text-xs text-[var(--ink-400)] text-center">
          Complete at least one outlet visit (arrival + departure) before submitting.
        </p>
      )}
    </div>
  );
}
