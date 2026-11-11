"use client";

import { useState } from "react";
import { createUserAction } from "@/app/(protected)/admin/users/actions";
import { ALL_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, roleUsesSupervisorLink, roleUsesTeamLeaderLink, type Role } from "@/lib/roles";

export interface LinkOption {
  id: string;
  name: string;
  email: string | null;
}

/** The "Add a new user" form, split out as its own client component so typing
 *  an email that matches an existing TeamLeader.email/Supervisor.email (set
 *  on /admin/team-leaders, or from the Sales Leadership CSV importer) can
 *  auto-pick the matching link and role — the admin no longer has to
 *  remember which roster entry is theirs. Role auto-fill only kicks in while
 *  the admin hasn't deliberately changed Role themselves, so a manual choice
 *  is never silently overwritten; the link field always follows a match. The
 *  Team Leader / Supervisor link only shows for the role it belongs to. */
export function NewUserForm({ teamLeaders, supervisors }: { teamLeaders: LinkOption[]; supervisors: LinkOption[] }) {
  const [role, setRole] = useState<Role>("VIEWER");
  const [roleTouched, setRoleTouched] = useState(false);
  const [teamLeaderId, setTeamLeaderId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [matchedLabel, setMatchedLabel] = useState<string | null>(null);

  function handleEmailChange(value: string) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      setMatchedLabel(null);
      return;
    }
    const matchedTeamLeader = teamLeaders.find((tl) => tl.email?.toLowerCase() === normalized);
    const matchedSupervisor = supervisors.find((s) => s.email?.toLowerCase() === normalized);
    if (matchedTeamLeader) {
      setTeamLeaderId(matchedTeamLeader.id);
      if (!roleTouched) setRole("TEAM_LEADER");
      setMatchedLabel(`Matched to Team Leader "${matchedTeamLeader.name}" by email.`);
    } else if (matchedSupervisor) {
      setSupervisorId(matchedSupervisor.id);
      if (!roleTouched) setRole("SUPERVISOR");
      setMatchedLabel(`Matched to Sales Supervisor "${matchedSupervisor.name}" by email.`);
    } else {
      setMatchedLabel(null);
    }
  }

  const labelClass = "text-[11px] font-semibold uppercase tracking-wide text-muted";
  const inputClass = "rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground outline-none focus:border-secondary-blue";

  return (
    <form action={createUserAction} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Name (optional)</span>
        <input name="name" type="text" className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Email</span>
        <input name="email" type="email" required onChange={(e) => handleEmailChange(e.target.value)} className={inputClass} />
        {matchedLabel ? <span className="text-[11px] font-medium text-accent-green">{matchedLabel}</span> : null}
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Password (min 8)</span>
        <input name="password" type="password" required minLength={8} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Role</span>
        <select
          name="role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role);
            setRoleTouched(true);
          }}
          className={inputClass}
        >
          {ALL_ROLES.map((value) => (
            <option key={value} value={value}>
              {ROLE_LABELS[value]}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted">{ROLE_DESCRIPTIONS[role]}</span>
      </label>
      {roleUsesTeamLeaderLink(role) ? (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Team Leader roster entry</span>
          <select name="teamLeaderId" required value={teamLeaderId} onChange={(e) => setTeamLeaderId(e.target.value)} className={inputClass}>
            <option value="">— pick one —</option>
            {teamLeaders.map((tl) => (
              <option key={tl.id} value={tl.id}>
                {tl.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {roleUsesSupervisorLink(role) ? (
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Sales Supervisor roster entry</span>
          <select name="supervisorId" required value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} className={inputClass}>
            <option value="">— pick one —</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Employee code{role === "SALES_REP" ? " · needed for My Sales" : " · optional"}</span>
        <input name="employeeCode" type="text" placeholder="e.g. 1181" className={inputClass} />
        <span className="text-[11px] text-muted">Links a rep&apos;s roster code to unlock their own My Sales page.</span>
      </label>
      <div className="flex items-end sm:col-span-2 2xl:col-span-3">
        <button
          type="submit"
          className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-2 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
        >
          Create user
        </button>
      </div>
    </form>
  );
}
