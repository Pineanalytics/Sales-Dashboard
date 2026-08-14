"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

const STATUS_STYLE: Record<Profile["status"], string> = {
  pending: "bg-[var(--sand-100)] text-[var(--ink-600)]",
  approved: "bg-[var(--pine-100)] text-[var(--pine-700)]",
  rejected: "bg-[#f5e2dd] text-[var(--rust-600)]",
};

const STATUS_ORDER: Record<Profile["status"], number> = {
  pending: 0,
  approved: 1,
  rejected: 2,
};

interface FormOption {
  id: string;
  title: string;
  system_type: string;
}
interface PrincipalOption {
  id: string;
  name: string;
  form_id: string;
}
interface TerritoryOption {
  id: string;
  name: string;
  form_id: string;
}

// Sales Reps never hold a login profile (they're a lightweight roster their
// Team Leader manages — see lib/coachingTypes.ts), so "sales_rep" is
// intentionally excluded here; only roles that make sense for a real
// account are assignable from this page.
const COACHING_FIELD_ROLES = [
  { value: "team_leader", label: "Team Leader" },
  { value: "supervisor", label: "Supervisor" },
  { value: "key_account_rep", label: "Key Account Rep" },
];

interface Draft {
  assigned_form_id: string;
  field_role: string;
  territory: string;
  principalIds: string[];
  teamLeaderIds: string[]; // for supervisors: which Team Leaders report to them
}

function draftFrom(p: Profile, teamLeaderPrincipals: Record<string, string[]>, allProfiles: Profile[]): Draft {
  return {
    assigned_form_id: p.assigned_form_id ?? "",
    field_role: p.field_role ?? "",
    territory: p.territory ?? "",
    principalIds: teamLeaderPrincipals[p.id] ?? [],
    teamLeaderIds: allProfiles.filter((tl) => tl.field_role === "team_leader" && tl.manager_id === p.id).map((tl) => tl.id),
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return (
    a.assigned_form_id === b.assigned_form_id &&
    a.field_role === b.field_role &&
    a.territory === b.territory &&
    a.principalIds.length === b.principalIds.length &&
    a.principalIds.every((id) => b.principalIds.includes(id)) &&
    a.teamLeaderIds.length === b.teamLeaderIds.length &&
    a.teamLeaderIds.every((id) => b.teamLeaderIds.includes(id))
  );
}

export default function UsersTable({
  profiles,
  currentUserId,
  isSuperAdmin,
  forms,
  adminFormAccess,
  principals,
  teamLeaderPrincipals,
  territories,
}: {
  profiles: Profile[];
  currentUserId: string;
  isSuperAdmin: boolean;
  forms: FormOption[];
  adminFormAccess: Record<string, string[]>;
  principals: PrincipalOption[];
  teamLeaderPrincipals: Record<string, string[]>;
  territories: TerritoryOption[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetOpenId, setResetOpenId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetDoneId, setResetDoneId] = useState<string | null>(null);
  const [allocationsOpenId, setAllocationsOpenId] = useState<string | null>(null);
  const [allocations, setAllocations] = useState(adminFormAccess);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  // Committed baseline (what's actually saved) vs. drafts (what's on
  // screen but not yet saved) — the Save button only becomes active once
  // a draft diverges from its baseline, and only that user's changes are
  // committed when clicked.
  const [committed, setCommitted] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(profiles.map((p) => [p.id, draftFrom(p, teamLeaderPrincipals, profiles)]))
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>(committed);

  function updateDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const formTitleById = new Map(forms.map((f) => [f.id, f.title]));
  const formSystemTypeById = new Map(forms.map((f) => [f.id, f.system_type]));
  const hasCoachingForm = forms.some((f) => f.system_type === "coaching");
  const teamLeaders = profiles.filter((p) => p.field_role === "team_leader");

  const sorted = [...profiles].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  async function updateProfile(id: string, patch: Partial<Profile>) {
    setError(null);
    setBusyId(id);
    const { error: updErr } = await supabase.from("profiles").update(patch).eq("id", id);
    setBusyId(null);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    router.refresh();
  }

  async function toggleAllocation(adminId: string, formId: string, checked: boolean) {
    setError(null);
    setBusyId(adminId);
    const { error: err } = checked
      ? await supabase.from("admin_form_access").insert({ admin_id: adminId, form_id: formId })
      : await supabase.from("admin_form_access").delete().eq("admin_id", adminId).eq("form_id", formId);
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setAllocations((prev) => {
      const current = prev[adminId] ?? [];
      return { ...prev, [adminId]: checked ? [...current, formId] : current.filter((id) => id !== formId) };
    });
  }

  // Commits everything pending in a user's draft in one go: the profile
  // row itself (assigned_form_id, field_role, territory), their Principal
  // assignments if they're a Team Leader, and which Team Leaders report to
  // them if they're a Supervisor (writes those Team Leaders' manager_id).
  async function saveDraft(p: Profile) {
    setError(null);
    setBusyId(p.id);
    const draft = drafts[p.id];

    const { error: profErr } = await supabase
      .from("profiles")
      .update({
        assigned_form_id: draft.assigned_form_id || null,
        field_role: draft.field_role || null,
        territory: draft.territory || null,
      })
      .eq("id", p.id);
    if (profErr) {
      setBusyId(null);
      setError(profErr.message);
      return;
    }

    // Key Account Reps self-log visits and need a matching coaching_sales_reps
    // row with id === their own profile id (every RLS policy checking
    // sales_rep_id = auth.uid() relies on that).
    if (draft.field_role === "key_account_rep" && draft.assigned_form_id) {
      const { error: provisionErr } = await supabase.from("coaching_sales_reps").upsert(
        { id: p.id, form_id: draft.assigned_form_id, full_name: p.full_name || p.email, team_leader_id: p.id },
        { onConflict: "id" }
      );
      if (provisionErr) {
        setBusyId(null);
        setError(provisionErr.message);
        return;
      }
    }

    if (draft.field_role === "team_leader") {
      const before = committed[p.id].principalIds;
      const toAdd = draft.principalIds.filter((id) => !before.includes(id));
      const toRemove = before.filter((id) => !draft.principalIds.includes(id));
      if (toAdd.length) {
        const { error: err } = await supabase
          .from("team_leader_principals")
          .insert(toAdd.map((principal_id) => ({ team_leader_id: p.id, principal_id })));
        if (err) {
          setBusyId(null);
          setError(err.message);
          return;
        }
      }
      for (const principal_id of toRemove) {
        await supabase.from("team_leader_principals").delete().eq("team_leader_id", p.id).eq("principal_id", principal_id);
      }
    }

    if (draft.field_role === "supervisor") {
      const before = committed[p.id].teamLeaderIds;
      const toAssign = draft.teamLeaderIds.filter((id) => !before.includes(id));
      const toUnassign = before.filter((id) => !draft.teamLeaderIds.includes(id));
      for (const tlId of toAssign) {
        await supabase.from("profiles").update({ manager_id: p.id }).eq("id", tlId);
      }
      for (const tlId of toUnassign) {
        await supabase.from("profiles").update({ manager_id: null }).eq("id", tlId);
      }
    }

    setBusyId(null);
    setCommitted((prev) => ({ ...prev, [p.id]: draft }));
    setSavedId(p.id);
    setTimeout(() => setSavedId((id) => (id === p.id ? null : id)), 3000);
    router.refresh();
  }

  async function submitNewPassword(p: Profile) {
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setError(null);
    setBusyId(p.id);
    const res = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: p.id, newPassword }),
    });
    const body = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(body.error ?? "Could not set password.");
      return;
    }
    setResetOpenId(null);
    setNewPassword("");
    setResetDoneId(p.id);
    setTimeout(() => setResetDoneId((id) => (id === p.id ? null : id)), 4000);
  }

  const pendingCount = profiles.filter((p) => p.status === "pending").length;
  const inputCls = "w-full rounded-md border border-[var(--line)] px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pine-500)]";
  const labelCls = "block text-[10px] font-mono-label uppercase tracking-wide text-[var(--ink-500)] mb-1";

  return (
    <div>
      {pendingCount > 0 && (
        <p className="mb-4 text-sm text-[var(--rust-600)]">
          {pendingCount} account{pendingCount === 1 ? "" : "s"} waiting for approval.
        </p>
      )}
      {error && (
        <p className="mb-4 text-sm text-[var(--rust-600)]" role="alert">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {sorted.map((p) => {
          const isSelf = p.id === currentUserId;
          const busy = busyId === p.id;
          const expanded = expandedId === p.id;
          const draft = drafts[p.id];
          const dirty = !draftsEqual(draft, committed[p.id]);
          const isCoaching = p.assigned_form_id && formSystemTypeById.get(p.assigned_form_id) === "coaching";
          const relevantTerritories = territories.filter((t) => t.form_id === draft.assigned_form_id);
          const relevantPrincipals = principals.filter((pr) => pr.form_id === draft.assigned_form_id);

          return (
            <div key={p.id} className="bg-white border border-[var(--line)] rounded-lg overflow-hidden">
              {/* Header row — always visible, no horizontal scroll needed */}
              <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                <div className="min-w-[160px]">
                  <p className="font-medium text-[var(--ink-900)] leading-tight">{p.full_name || "—"}</p>
                  <p className="text-xs text-[var(--ink-500)] leading-tight">{p.email}</p>
                </div>
                <span className={`text-[10px] font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 ${STATUS_STYLE[p.status]}`}>
                  {p.status}
                </span>
                <span className="text-[10px] font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 bg-[var(--sand-100)] text-[var(--ink-600)]">
                  {p.role.replace("_", " ")}
                </span>
                {p.field_role && (
                  <span className="text-[10px] font-mono-label uppercase tracking-wide rounded-full px-2 py-0.5 bg-[var(--sand-100)] text-[var(--ink-600)]">
                    {p.field_role.replace("_", " ")}
                  </span>
                )}
                <span className="text-xs text-[var(--ink-400)]">
                  {p.assigned_form_id ? formTitleById.get(p.assigned_form_id) ?? "—" : "Unassigned"}
                </span>

                <div className="ml-auto flex items-center gap-3 whitespace-nowrap">
                  {savedId === p.id && <span className="text-xs text-[var(--pine-700)]">Saved ✓</span>}
                  {!isSelf && p.status !== "approved" && (
                    <button
                      disabled={busy}
                      onClick={() => updateProfile(p.id, { status: "approved" })}
                      className="text-xs font-medium text-[var(--pine-700)] hover:underline disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {!isSelf && p.status !== "rejected" && (
                    <button
                      disabled={busy}
                      onClick={() => updateProfile(p.id, { status: "rejected" })}
                      className="text-xs font-medium text-[var(--rust-600)] hover:underline disabled:opacity-50"
                    >
                      Reject
                    </button>
                  )}
                  {isSelf ? (
                    <span className="text-xs text-[var(--ink-400)]">You</span>
                  ) : (
                    <button
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                      className="text-xs font-medium text-[var(--ink-600)] hover:text-[var(--pine-700)] hover:underline"
                    >
                      {expanded ? "Close" : "Manage"}
                    </button>
                  )}
                </div>
              </div>

              {/* Expandable manage panel — everything that used to require
                  horizontal scrolling lives here instead, stacked vertically. */}
              {expanded && !isSelf && (
                <div className="border-t border-[var(--line)] bg-[var(--sand-50)] px-4 py-4 space-y-4">
                  {/* Quick admin actions — immediate, not part of the draft/save flow */}
                  <div className="flex flex-wrap items-center gap-3">
                    {p.status === "approved" && p.role !== "super_admin" && (
                      <button
                        disabled={busy}
                        onClick={() => updateProfile(p.id, { role: p.role === "admin" ? "user" : "admin" })}
                        className="text-xs font-medium text-[var(--ink-600)] hover:text-[var(--pine-700)] hover:underline disabled:opacity-50"
                      >
                        {p.role === "admin" ? "Revoke admin" : "Make admin"}
                      </button>
                    )}
                    {isSuperAdmin && p.status === "approved" && p.role === "admin" && (
                      <button
                        disabled={busy}
                        onClick={() => setAllocationsOpenId(allocationsOpenId === p.id ? null : p.id)}
                        className="text-xs font-medium text-[var(--ink-600)] hover:text-[var(--pine-700)] hover:underline disabled:opacity-50"
                      >
                        Manage forms ({(allocations[p.id] ?? []).length})
                      </button>
                    )}
                    {isSuperAdmin && p.status === "approved" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          updateProfile(p.id, {
                            role: p.role === "super_admin" ? "user" : "super_admin",
                            assigned_form_id: p.role === "super_admin" ? p.assigned_form_id : null,
                          })
                        }
                        className="text-xs font-medium text-[var(--pine-700)] hover:underline disabled:opacity-50"
                      >
                        {p.role === "super_admin" ? "Revoke super admin" : "Make super admin"}
                      </button>
                    )}
                    {isSuperAdmin && p.status === "approved" && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setError(null);
                          setNewPassword("");
                          setResetOpenId(resetOpenId === p.id ? null : p.id);
                        }}
                        className="text-xs font-medium text-[var(--ink-600)] hover:text-[var(--pine-700)] hover:underline disabled:opacity-50"
                      >
                        {resetDoneId === p.id ? "Password set ✓" : "Set password"}
                      </button>
                    )}
                  </div>

                  {resetOpenId === p.id && (
                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        autoFocus
                        minLength={6}
                        placeholder="New password (min 6 chars)"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className={`${inputCls} max-w-xs`}
                      />
                      <button
                        disabled={busy}
                        onClick={() => submitNewPassword(p)}
                        className="text-xs font-medium text-white bg-[var(--pine-700)] rounded-md px-2.5 py-1.5 hover:bg-[var(--pine-900)] disabled:opacity-50"
                      >
                        {busy ? "Saving…" : "Save"}
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setResetOpenId(null);
                          setNewPassword("");
                          setError(null);
                        }}
                        className="text-xs text-[var(--ink-400)] hover:text-[var(--rust-600)]"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {allocationsOpenId === p.id && (
                    <div className="flex flex-wrap gap-3 bg-white rounded-md p-2.5 border border-[var(--line)]">
                      {forms.length === 0 && <span className="text-xs text-[var(--ink-400)]">No forms exist yet.</span>}
                      {forms.map((f) => (
                        <label key={f.id} className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={(allocations[p.id] ?? []).includes(f.id)}
                            onChange={(e) => toggleAllocation(p.id, f.id, e.target.checked)}
                          />
                          {f.title}
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Editable fields — draft state, only committed on Save */}
                  {forms.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Form</label>
                        <select
                          disabled={busy}
                          value={draft.assigned_form_id}
                          onChange={(e) => updateDraft(p.id, { assigned_form_id: e.target.value })}
                          className={inputCls}
                        >
                          <option value="">Unassigned</option>
                          {forms.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.title}
                            </option>
                          ))}
                        </select>
                      </div>

                      {hasCoachingForm && isCoaching && (
                        <div>
                          <label className={labelCls}>Field Role</label>
                          <select
                            disabled={busy}
                            value={draft.field_role}
                            onChange={(e) => updateDraft(p.id, { field_role: e.target.value })}
                            className={inputCls}
                          >
                            <option value="">Not set</option>
                            {COACHING_FIELD_ROLES.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {hasCoachingForm && isCoaching && (draft.field_role === "team_leader" || draft.field_role === "supervisor") && (
                        <div>
                          <label className={labelCls}>Territory</label>
                          <select
                            disabled={busy}
                            value={draft.territory}
                            onChange={(e) => updateDraft(p.id, { territory: e.target.value })}
                            className={inputCls}
                          >
                            <option value="">Not set</option>
                            {relevantTerritories.map((t) => (
                              <option key={t.id} value={t.name}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                          {relevantTerritories.length === 0 && (
                            <p className="text-[10px] text-[var(--ink-400)] mt-1">No territories yet — add them in Master Data.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {hasCoachingForm && isCoaching && draft.field_role === "team_leader" && (
                    <div>
                      <label className={labelCls}>Principals served</label>
                      {relevantPrincipals.length === 0 ? (
                        <p className="text-xs text-[var(--ink-400)]">No Principals yet — add them in Master Data.</p>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 bg-white rounded-md p-2.5 border border-[var(--line)]">
                          {relevantPrincipals.map((pr) => (
                            <label key={pr.id} className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={draft.principalIds.includes(pr.id)}
                                onChange={(e) =>
                                  updateDraft(p.id, {
                                    principalIds: e.target.checked
                                      ? [...draft.principalIds, pr.id]
                                      : draft.principalIds.filter((id) => id !== pr.id),
                                  })
                                }
                              />
                              {pr.name}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {hasCoachingForm && isCoaching && draft.field_role === "supervisor" && (
                    <div>
                      <label className={labelCls}>Team Leaders reporting to them</label>
                      {teamLeaders.length === 0 ? (
                        <p className="text-xs text-[var(--ink-400)]">No Team Leaders exist yet.</p>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 gap-y-1.5 bg-white rounded-md p-2.5 border border-[var(--line)]">
                          {teamLeaders.map((tl) => (
                            <label key={tl.id} className="flex items-center gap-1.5 text-xs whitespace-nowrap">
                              <input
                                type="checkbox"
                                disabled={busy}
                                checked={draft.teamLeaderIds.includes(tl.id)}
                                onChange={(e) =>
                                  updateDraft(p.id, {
                                    teamLeaderIds: e.target.checked
                                      ? [...draft.teamLeaderIds, tl.id]
                                      : draft.teamLeaderIds.filter((id) => id !== tl.id),
                                  })
                                }
                              />
                              {tl.full_name || tl.email}
                              {tl.manager_id && tl.manager_id !== p.id && (
                                <span className="text-[var(--ink-400)]"> (currently under another Supervisor)</span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {(forms.length > 0 || (hasCoachingForm && isCoaching)) && (
                    <div className="flex items-center gap-3 pt-1">
                      <button
                        disabled={!dirty || busy}
                        onClick={() => saveDraft(p)}
                        className="rounded-md bg-[var(--pine-700)] text-white text-sm font-medium px-4 py-2 hover:bg-[var(--pine-900)] disabled:opacity-40"
                      >
                        {busy ? "Saving…" : "Save changes"}
                      </button>
                      {dirty && <span className="text-xs text-[var(--ink-500)]">Unsaved changes</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
