"use client";

import Link from "next/link";
import {
  createTeamLeaderAction,
  createSupervisorAction,
  renameSupervisorAction,
  deleteSupervisorAction,
  updateSupervisorManagerAction,
  updateSupervisorVisiblePagesAction,
  updateSupervisorCanEditTargetsAction,
  updateManagerHodAction,
  createHodAction,
  renameHodAction,
  deleteHodAction,
  updateHodDirectorAction,
  createDirectorAction,
  renameDirectorAction,
  deleteDirectorAction,
} from "./actions";
import { TeamLeaderRosterPanel, type TeamLeaderRow, type SupervisorOption } from "./TeamLeaderRosterPanel";
import {
  buildRosterHierarchy,
  type HierarchyDirector,
  type HierarchyHod,
  type HierarchyManager,
  type HierarchySupervisor,
  type HierarchyTeamLeader,
  type SupervisorNode,
  type ManagerNode,
  type HodNode,
  type DirectorNode,
} from "@/lib/rosterHierarchy";
import { ALL_PAGE_KEYS, PAGE_LABELS } from "@/lib/pageAccess";

// This tree's Sales Supervisor rows carry an extra visiblePages field beyond
// the base HierarchySupervisor shape (the admin-settable page-access
// override) — these aliases thread that concrete shape through every
// generic *Node type below instead of falling back to the bare defaults,
// which would type it away by the time it reaches SupervisorNodeView.
type TreeSupervisor = HierarchySupervisor & { visiblePages: string[]; canEditTargets: boolean };
type TreeSupervisorNode = SupervisorNode<HierarchyTeamLeader, TreeSupervisor>;
type TreeManagerNode = ManagerNode<HierarchyTeamLeader, TreeSupervisor>;
type TreeHodNode = HodNode<HierarchyTeamLeader, TreeSupervisor>;
type TreeDirectorNode = DirectorNode<HierarchyTeamLeader, TreeSupervisor>;

/** Replaces the page's former six disconnected flat sections (Team Leader
 *  roster / Sales Supervisor roster / Supervisor->Manager / Manager->Hod /
 *  Hod->Director / Director roster) with one consolidated org tree —
 *  Director -> Head of Sales -> Manager -> Sales Supervisor -> Team Leader,
 *  nested by lib/rosterHierarchy.ts's buildRosterHierarchy. Every mutation
 *  below is the exact same server action this page already used; only the
 *  layout changed. Each <summary> stays plain text/badges only (matching
 *  this file's own pre-existing TeamLeaderRosterPanel convention) — actions
 *  live in the expanded body, since <details><summary> may only contain
 *  phrasing content and nesting a <form> inside it risks an SSR/hydration
 *  mismatch if the browser's HTML parser reparents it. A Team Leader row's
 *  "View roster" link is the bridge into the Assignments cascade filter
 *  below (a real navigation to ?filterTeamLeader=<id>, which
 *  RosterAssignmentsCascade already seeds its initial selection from) — this
 *  is what makes the tree and the Assignments table feel like one page
 *  instead of two unrelated widgets. */
export function RosterHierarchyTree({
  teamLeaders,
  supervisors,
  managers,
  hods,
  directors,
  renamingTeamLeaderId,
  renamingSupervisorId,
  renamingHodId,
  renamingDirectorId,
  inputClass,
  labelClass,
}: {
  teamLeaders: TeamLeaderRow[];
  supervisors: TreeSupervisor[];
  managers: HierarchyManager[];
  hods: HierarchyHod[];
  directors: HierarchyDirector[];
  renamingTeamLeaderId?: string;
  renamingSupervisorId?: string;
  renamingHodId?: string;
  renamingDirectorId?: string;
  inputClass: string;
  labelClass: string;
}) {
  const hierarchy = buildRosterHierarchy(
    teamLeaders.map((tl) => ({ id: tl.id, name: tl.name, supervisorId: tl.supervisorId })),
    supervisors,
    managers,
    hods,
    directors
  );
  const teamLeadersById = new Map(teamLeaders.map((tl) => [tl.id, tl]));
  const supervisorOptions: SupervisorOption[] = supervisors.map((s) => ({ id: s.id, name: s.name }));

  function teamLeaderRowsFor(refs: { id: string }[]): TeamLeaderRow[] {
    return refs.map((ref) => teamLeadersById.get(ref.id)).filter((tl): tl is TeamLeaderRow => Boolean(tl));
  }

  const nothingYet =
    hierarchy.directors.length === 0 &&
    hierarchy.unassignedHods.length === 0 &&
    hierarchy.unassignedManagers.length === 0 &&
    hierarchy.unassignedSupervisors.length === 0 &&
    hierarchy.unassignedTeamLeaders.length === 0;

  return (
    <div className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-primary-blue">Organization</h2>
        <p className="mt-1 text-[13px] text-muted">
          Director → Head of Sales → Manager → Sales Supervisor → Team Leader, in one tree — this is the master data
          area, so every reporting line, Visible pages override, and Team Leader roster lives here instead of across
          separate pages.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <form action={createTeamLeaderAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className={labelClass}>New Team Leader</label>
            <input name="name" required placeholder="Christine" className={inputClass} />
          </div>
          <button type="submit" className="rounded-full bg-background-elevated px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
            + Team Leader
          </button>
        </form>
        <form action={createSupervisorAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className={labelClass}>New Sales Supervisor</label>
            <input name="name" required placeholder="Lucy Githinji" className={inputClass} />
          </div>
          <button type="submit" className="rounded-full bg-background-elevated px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
            + Supervisor
          </button>
        </form>
        <form action={createHodAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className={labelClass}>New Head of Sales</label>
            <input name="name" required placeholder="Head of Sales name" className={inputClass} />
          </div>
          <button type="submit" className="rounded-full bg-background-elevated px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
            + Head of Sales
          </button>
        </form>
        <form action={createDirectorAction} className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className={labelClass}>New Director</label>
            <input name="name" required placeholder="Director name" className={inputClass} />
          </div>
          <button type="submit" className="rounded-full bg-background-elevated px-4 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
            + Director
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-3">
        {hierarchy.directors.map((director) => (
          <DirectorNodeView
            key={director.id}
            director={director}
            directors={directors}
            teamLeaderRowsFor={teamLeaderRowsFor}
            supervisorOptions={supervisorOptions}
            renamingTeamLeaderId={renamingTeamLeaderId}
            renamingHodId={renamingHodId}
            renamingDirectorId={renamingDirectorId}
            renamingSupervisorId={renamingSupervisorId}
            inputClass={inputClass}
          />
        ))}

        {hierarchy.unassignedHods.length > 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-4">
            <p className="text-[13px] font-medium text-muted-strong mb-2">Head of Sales not yet reporting to a Director</p>
            <div className="flex flex-col gap-3">
              {hierarchy.unassignedHods.map((hod) => (
                <HodNodeView
                  key={hod.id}
                  hod={hod}
                  directors={directors}
                  teamLeaderRowsFor={teamLeaderRowsFor}
                  supervisorOptions={supervisorOptions}
                  renamingTeamLeaderId={renamingTeamLeaderId}
                  renamingHodId={renamingHodId}
                  renamingSupervisorId={renamingSupervisorId}
                  inputClass={inputClass}
                />
              ))}
            </div>
          </div>
        ) : null}

        {hierarchy.unassignedManagers.length > 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-4">
            <p className="text-[13px] font-medium text-muted-strong mb-2">Managers not yet reporting to a Head of Sales</p>
            <div className="flex flex-col gap-3">
              {hierarchy.unassignedManagers.map((manager) => (
                <ManagerNodeView
                  key={manager.id}
                  manager={manager}
                  hods={hods}
                  teamLeaderRowsFor={teamLeaderRowsFor}
                  supervisorOptions={supervisorOptions}
                  renamingTeamLeaderId={renamingTeamLeaderId}
                  renamingSupervisorId={renamingSupervisorId}
                  inputClass={inputClass}
                />
              ))}
            </div>
          </div>
        ) : null}

        {hierarchy.unassignedSupervisors.length > 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-4">
            <p className="text-[13px] font-medium text-muted-strong mb-2">Sales Supervisors not yet reporting to a Manager</p>
            <div className="flex flex-col gap-3">
              {hierarchy.unassignedSupervisors.map((supervisor) => (
                <SupervisorNodeView
                  key={supervisor.id}
                  supervisor={supervisor}
                  managers={managers}
                  teamLeaderRowsFor={teamLeaderRowsFor}
                  supervisorOptions={supervisorOptions}
                  renamingTeamLeaderId={renamingTeamLeaderId}
                  renamingSupervisorId={renamingSupervisorId}
                  inputClass={inputClass}
                />
              ))}
            </div>
          </div>
        ) : null}

        {hierarchy.unassignedTeamLeaders.length > 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 p-4">
            <p className="text-[13px] font-medium text-muted-strong mb-2">Team Leaders not yet reporting to a Sales Supervisor</p>
            <TeamLeaderRosterPanel
              teamLeaders={teamLeaderRowsFor(hierarchy.unassignedTeamLeaders)}
              supervisors={supervisorOptions}
              renamingId={renamingTeamLeaderId}
              inputClass={inputClass}
            />
          </div>
        ) : null}

        {nothingYet ? <p className="text-sm text-muted">Nothing in the organization yet — add a Team Leader or Sales Supervisor above to get started.</p> : null}
      </div>
    </div>
  );
}

function DirectorNodeView({
  director,
  teamLeaderRowsFor,
  supervisorOptions,
  renamingTeamLeaderId,
  renamingHodId,
  renamingDirectorId,
  renamingSupervisorId,
  inputClass,
}: {
  director: TreeDirectorNode;
  directors: HierarchyDirector[];
  teamLeaderRowsFor: (refs: { id: string }[]) => TeamLeaderRow[];
  supervisorOptions: SupervisorOption[];
  renamingTeamLeaderId?: string;
  renamingHodId?: string;
  renamingDirectorId?: string;
  renamingSupervisorId?: string;
  inputClass: string;
}) {
  const renaming = renamingDirectorId === director.id;
  return (
    <details open className="rounded-xl bg-background-elevated">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{director.name}</span>
        <span className="text-[13px] font-normal text-muted">Director</span>
        <span className="ml-auto text-[12px] text-muted">
          {director.hods.length} Head{director.hods.length === 1 ? "" : "s"} of Sales
        </span>
      </summary>
      <div className="px-4 pb-4 pl-8 flex flex-col gap-3 border-t border-border/60 pt-3">
        {renaming ? (
          <form action={renameDirectorAction} className="flex items-center gap-2">
            <input type="hidden" name="directorId" value={director.id} />
            <input name="name" defaultValue={director.name} className={inputClass} />
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
              Save
            </button>
            <Link href="/admin/team-leaders" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
              Cancel
            </Link>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <Link href={`/admin/team-leaders?renameDirector=${director.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
              Rename
            </Link>
            <form action={deleteDirectorAction} className="inline">
              <input type="hidden" name="directorId" value={director.id} />
              <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft">
                Remove
              </button>
            </form>
          </div>
        )}
        {director.hods.map((hod) => (
          <HodNodeView
            key={hod.id}
            hod={hod}
            directors={[]}
            teamLeaderRowsFor={teamLeaderRowsFor}
            supervisorOptions={supervisorOptions}
            renamingTeamLeaderId={renamingTeamLeaderId}
            renamingHodId={renamingHodId}
            renamingSupervisorId={renamingSupervisorId}
            inputClass={inputClass}
          />
        ))}
        {director.hods.length === 0 ? <p className="text-[13px] text-muted">No Head of Sales reporting to this Director yet.</p> : null}
      </div>
    </details>
  );
}

function HodNodeView({
  hod,
  directors,
  teamLeaderRowsFor,
  supervisorOptions,
  renamingTeamLeaderId,
  renamingHodId,
  renamingSupervisorId,
  inputClass,
}: {
  hod: TreeHodNode;
  directors: HierarchyDirector[];
  teamLeaderRowsFor: (refs: { id: string }[]) => TeamLeaderRow[];
  supervisorOptions: SupervisorOption[];
  renamingTeamLeaderId?: string;
  renamingHodId?: string;
  renamingSupervisorId?: string;
  inputClass: string;
}) {
  const renaming = renamingHodId === hod.id;
  return (
    <details open className="rounded-xl bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{hod.name}</span>
        <span className="text-[13px] font-normal text-muted">Head of Sales</span>
        <span className="ml-auto text-[12px] text-muted">
          {hod.managers.length} Manager{hod.managers.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="px-4 pb-4 pl-8 flex flex-col gap-3 border-t border-border/60 pt-3">
        {renaming ? (
          <form action={renameHodAction} className="flex items-center gap-2">
            <input type="hidden" name="hodId" value={hod.id} />
            <input name="name" defaultValue={hod.name} className={inputClass} />
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
              Save
            </button>
            <Link href="/admin/team-leaders" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
              Cancel
            </Link>
          </form>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {directors.length > 0 ? (
              <form action={updateHodDirectorAction} className="flex items-center gap-1.5">
                <input type="hidden" name="hodId" value={hod.id} />
                <span className="text-[13px] text-muted">Reports to</span>
                <select name="directorId" defaultValue={hod.directorId ?? ""} className={inputClass + " py-1 text-xs"}>
                  <option value="">— none —</option>
                  {directors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
                  Save
                </button>
              </form>
            ) : null}
            <Link href={`/admin/team-leaders?renameHod=${hod.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
              Rename
            </Link>
            <form action={deleteHodAction} className="inline">
              <input type="hidden" name="hodId" value={hod.id} />
              <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft">
                Remove
              </button>
            </form>
          </div>
        )}
        {hod.managers.map((manager) => (
          <ManagerNodeView
            key={manager.id}
            manager={manager}
            hods={[]}
            teamLeaderRowsFor={teamLeaderRowsFor}
            supervisorOptions={supervisorOptions}
            renamingTeamLeaderId={renamingTeamLeaderId}
            renamingSupervisorId={renamingSupervisorId}
            inputClass={inputClass}
          />
        ))}
        {hod.managers.length === 0 ? <p className="text-[13px] text-muted">No Manager reporting to this Head of Sales yet.</p> : null}
      </div>
    </details>
  );
}

function ManagerNodeView({
  manager,
  hods,
  teamLeaderRowsFor,
  supervisorOptions,
  renamingTeamLeaderId,
  renamingSupervisorId,
  inputClass,
}: {
  manager: TreeManagerNode;
  hods: HierarchyHod[];
  teamLeaderRowsFor: (refs: { id: string }[]) => TeamLeaderRow[];
  supervisorOptions: SupervisorOption[];
  renamingTeamLeaderId?: string;
  renamingSupervisorId?: string;
  inputClass: string;
}) {
  return (
    <details open className="rounded-xl bg-background-elevated">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{manager.name}</span>
        <span className="text-[13px] font-normal text-muted">Manager</span>
        <span className="ml-auto text-[12px] text-muted">
          {manager.supervisors.length} Supervisor{manager.supervisors.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="px-4 pb-4 pl-8 flex flex-col gap-3 border-t border-border/60 pt-3">
        <p className="text-[12px] text-muted">Managers are sourced from the Roster CSV upload, not created here.</p>
        {hods.length > 0 ? (
          <form action={updateManagerHodAction} className="flex items-center gap-1.5">
            <input type="hidden" name="managerId" value={manager.id} />
            <span className="text-[13px] text-muted">Reports to</span>
            <select name="hodId" defaultValue={manager.hodId ?? ""} className={inputClass + " py-1 text-xs"}>
              <option value="">— none —</option>
              {hods.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
              Save
            </button>
          </form>
        ) : null}
        {manager.supervisors.map((supervisor) => (
          <SupervisorNodeView
            key={supervisor.id}
            supervisor={supervisor}
            managers={[]}
            teamLeaderRowsFor={teamLeaderRowsFor}
            supervisorOptions={supervisorOptions}
            renamingTeamLeaderId={renamingTeamLeaderId}
            renamingSupervisorId={renamingSupervisorId}
            inputClass={inputClass}
          />
        ))}
        {manager.supervisors.length === 0 ? <p className="text-[13px] text-muted">No Sales Supervisor reporting to this Manager yet.</p> : null}
      </div>
    </details>
  );
}

function SupervisorNodeView({
  supervisor,
  managers,
  teamLeaderRowsFor,
  supervisorOptions,
  renamingTeamLeaderId,
  renamingSupervisorId,
  inputClass,
}: {
  supervisor: TreeSupervisorNode;
  managers: HierarchyManager[];
  teamLeaderRowsFor: (refs: { id: string }[]) => TeamLeaderRow[];
  supervisorOptions: SupervisorOption[];
  renamingTeamLeaderId?: string;
  renamingSupervisorId?: string;
  inputClass: string;
}) {
  const renaming = renamingSupervisorId === supervisor.id;
  return (
    <details open className="rounded-xl bg-surface">
      <summary className="cursor-pointer list-none px-4 py-3 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">{supervisor.name}</span>
        <span className="text-[13px] font-normal text-muted">Sales Supervisor</span>
        <span className="ml-auto text-[12px] text-muted">
          {supervisor.teamLeaders.length} Team Leader{supervisor.teamLeaders.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="px-4 pb-4 pl-8 flex flex-col gap-3 border-t border-border/60 pt-3">
        {renaming ? (
          <form action={renameSupervisorAction} className="flex items-center gap-2">
            <input type="hidden" name="supervisorId" value={supervisor.id} />
            <input name="name" defaultValue={supervisor.name} className={inputClass} />
            <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
              Save
            </button>
            <Link href="/admin/team-leaders" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-background-elevated">
              Cancel
            </Link>
          </form>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {managers.length > 0 ? (
              <form action={updateSupervisorManagerAction} className="flex items-center gap-1.5">
                <input type="hidden" name="supervisorId" value={supervisor.id} />
                <span className="text-[13px] text-muted">Reports to</span>
                <select name="managerId" defaultValue={supervisor.managerId ?? ""} className={inputClass + " py-1 text-xs"}>
                  <option value="">— none —</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="rounded-full bg-background px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
                  Save
                </button>
              </form>
            ) : null}
            <Link href={`/admin/team-leaders?renameSupervisor=${supervisor.id}`} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
              Rename
            </Link>
            <form action={deleteSupervisorAction} className="inline">
              <input type="hidden" name="supervisorId" value={supervisor.id} />
              <button type="submit" className="rounded-full px-3 py-1.5 text-xs font-medium text-accent-red hover:bg-accent-red-soft">
                Remove
              </button>
            </form>
          </div>
        )}
        <details>
          <summary className="cursor-pointer text-[12px] font-medium text-primary-blue">
            Visible pages override {supervisor.visiblePages.length > 0 ? `(${supervisor.visiblePages.length} set)` : "(none — uses own account permissions)"}
          </summary>
          <form action={updateSupervisorVisiblePagesAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="supervisorId" value={supervisor.id} />
            <p className="text-[12px] text-muted">Leave everything unchecked to use this person&apos;s own account permissions.</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {ALL_PAGE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-1.5 text-[13px] text-foreground">
                  <input type="checkbox" name="pages" value={key} defaultChecked={supervisor.visiblePages.includes(key)} />
                  {PAGE_LABELS[key]}
                </label>
              ))}
            </div>
            <button type="submit" className="self-start rounded-full bg-background px-4 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
              Save visible pages
            </button>
          </form>
        </details>
        <form action={updateSupervisorCanEditTargetsAction} className="flex items-center gap-2">
          <input type="hidden" name="supervisorId" value={supervisor.id} />
          <label className="flex items-center gap-1.5 text-[13px] text-foreground">
            <input type="checkbox" name="canEditTargets" defaultChecked={supervisor.canEditTargets} />
            Can edit Monthly Targets
          </label>
          <button type="submit" className="rounded-full bg-background px-4 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft">
            Save
          </button>
        </form>
        <TeamLeaderRosterPanel
          teamLeaders={teamLeaderRowsFor(supervisor.teamLeaders)}
          supervisors={supervisorOptions}
          renamingId={renamingTeamLeaderId}
          inputClass={inputClass}
        />
      </div>
    </details>
  );
}
