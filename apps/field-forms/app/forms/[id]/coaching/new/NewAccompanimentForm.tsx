"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MapPin } from "@/components/CoachingMap";

const CoachingMap = dynamic(() => import("@/components/CoachingMap").then((m) => m.CoachingMap), {
  ssr: false,
});

export default function NewAccompanimentForm({
  formId,
  templateId,
  reps,
  routes,
  selfMode = false,
}: {
  formId: string;
  templateId: string;
  reps: { id: string; full_name: string; email: string | null }[];
  routes: { id: string; name: string }[];
  // Key Account Reps self-log their own visits — there's no Sales Rep to
  // pick, since their own auto-provisioned coaching_sales_reps row (id ===
  // their own profile id, see app/api/admin/coaching-roster/route.ts) IS
  // the "rep" for the accompaniment. `reps` already resolves to just that
  // one row for them (same team_leader_id = user.id query as Team Leaders
  // use), so this just skips the picker UI and auto-selects it.
  selfMode?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [repsList, setRepsList] = useState(reps);
  const [repId, setRepId] = useState(reps[0]?.id ?? "");
  const [routeId, setRouteId] = useState("");
  const [pins, setPins] = useState<MapPin[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newRepName, setNewRepName] = useState("");
  const [addingRep, setAddingRep] = useState(false);

  async function addRep() {
    if (!newRepName.trim()) return;
    setAddingRep(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("coaching_sales_reps")
      .insert({ form_id: formId, full_name: newRepName.trim(), team_leader_id: user!.id })
      .select("id, full_name, email")
      .single();
    setAddingRep(false);
    if (err) {
      setError(err.message);
      return;
    }
    setRepsList((prev) => [...prev, data as { id: string; full_name: string; email: string | null }]);
    setRepId(data!.id);
    setNewRepName("");
  }

  useEffect(() => {
    if (!repId) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from("coaching_journey_plans")
      .select("id, outlet_id, coaching_outlets(id, name, latitude, longitude, geofence_radius_m)")
      .eq("sales_rep_id", repId)
      .eq("plan_date", today)
      .then(({ data }) => {
        const rows = (data ?? []) as any[];
        setPins(
          rows
            .filter((r) => r.coaching_outlets?.latitude && r.coaching_outlets?.longitude)
            .map((r) => ({
              id: r.outlet_id,
              label: r.coaching_outlets.name,
              latitude: r.coaching_outlets.latitude,
              longitude: r.coaching_outlets.longitude,
              status: "planned" as const,
              geofenceRadiusM: r.coaching_outlets.geofence_radius_m,
              popupContent: r.coaching_outlets.name,
            }))
        );
      });
  }, [repId, supabase]);

  async function start() {
    if (!repId) {
      setError(selfMode ? "Your rep profile isn't set up yet — contact your admin." : "Select a Sales Rep first.");
      return;
    }
    setBusy(true);
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("coaching_accompaniments")
      .insert({
        form_id: formId,
        template_id: templateId,
        team_leader_id: user!.id,
        sales_rep_id: repId,
        route_id: routeId || null,
        status: "draft",
        start_time: new Date().toISOString(),
      })
      .select("id")
      .single();
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.push(`/forms/${formId}/coaching/${data!.id}`);
  }

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-[var(--rust-600)]">{error}</p>}

      {!selfMode && (
        <div>
          <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
            Sales Representative
          </label>
          <select
            value={repId}
            onChange={(e) => setRepId(e.target.value)}
            className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm"
          >
            {repsList.length === 0 && <option value="">No sales reps yet — add one below</option>}
            {repsList.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={newRepName}
              onChange={(e) => setNewRepName(e.target.value)}
              placeholder="New sales rep's name"
              className="flex-1 rounded-md border border-[var(--line)] px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={addingRep}
              onClick={addRep}
              className="rounded-md border border-[var(--line)] text-sm font-medium px-3 py-1.5 hover:border-[var(--pine-500)] disabled:opacity-50"
            >
              {addingRep ? "Adding..." : "+ Add"}
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
          Route
        </label>
        <select
          value={routeId}
          onChange={(e) => setRouteId(e.target.value)}
          className="w-full rounded-md border border-[var(--line)] px-3 py-2 text-sm"
        >
          <option value="">Select a route...</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-mono-label uppercase tracking-wide text-[var(--ink-600)] mb-1">
          Today&apos;s planned outlets
        </label>
        <CoachingMap pins={pins} height={320} />
        {pins.length === 0 && (
          <p className="text-xs text-[var(--ink-400)] mt-1">
            No Journey Plan outlets found for today for this rep.
          </p>
        )}
      </div>

      <button
        disabled={busy}
        onClick={start}
        className="w-full rounded-md bg-[var(--pine-700)] text-white text-sm font-medium py-2.5 hover:bg-[var(--pine-900)] disabled:opacity-50"
      >
        {busy ? "Starting..." : selfMode ? "Log Visit" : "Start Accompaniment"}
      </button>
    </div>
  );
}
