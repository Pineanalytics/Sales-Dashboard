"use client";

import { useState } from "react";
import { createUserAction } from "@/app/(protected)/admin/users/actions";

type Role = "VIEWER" | "ADMIN" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR";

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
 *  is never silently overwritten; the link field always follows a match. */
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

  const inputClass = "rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none focus:border-secondary-blue";

  return (
    <form action={createUserAction} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-[13px] font-medium text-muted-strong">
          Name (optional)
        </label>
        <input id="name" name="name" type="text" className={inputClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-[13px] font-medium text-muted-strong">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          onChange={(e) => handleEmailChange(e.target.value)}
          className={inputClass}
        />
        {matchedLabel ? <span className="text-xs font-medium text-accent-green">{matchedLabel}</span> : null}
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-[13px] font-medium text-muted-strong">
          Password (min 8 characters)
        </label>
        <input id="password" name="password" type="password" required minLength={8} className={inputClass} />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="role" className="text-[13px] font-medium text-muted-strong">
          Role
        </label>
        <select
          id="role"
          name="role"
          value={role}
          onChange={(e) => {
            setRole(e.target.value as Role);
            setRoleTouched(true);
          }}
          className={inputClass}
        >
          <option value="VIEWER">Viewer — read-only dashboard access</option>
          <option value="ADMIN">Admin — can upload new snapshots</option>
          <option value="TEAM_LEADER">Team Leader — enters their own Weekly Targets</option>
          <option value="SUPERVISOR">Sales Supervisor — manages their whole Team Leader group&apos;s roster/targets</option>
          <option value="HOD">Head of Sales — fills the company-wide HOD Performance Tracker</option>
          <option value="DIRECTOR">Director — reviews the HOD Performance Tracker</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="teamLeaderId" className="text-[13px] font-medium text-muted-strong">
          Team Leader link (only used if Role is Team Leader)
        </label>
        <select
          id="teamLeaderId"
          name="teamLeaderId"
          value={teamLeaderId}
          onChange={(e) => setTeamLeaderId(e.target.value)}
          className={inputClass}
        >
          <option value="">— none —</option>
          {teamLeaders.map((tl) => (
            <option key={tl.id} value={tl.id}>
              {tl.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="supervisorId" className="text-[13px] font-medium text-muted-strong">
          Sales Supervisor link (only used if Role is Sales Supervisor)
        </label>
        <select
          id="supervisorId"
          name="supervisorId"
          value={supervisorId}
          onChange={(e) => setSupervisorId(e.target.value)}
          className={inputClass}
        >
          <option value="">— none —</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-5 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
        >
          Create user
        </button>
      </div>
    </form>
  );
}
