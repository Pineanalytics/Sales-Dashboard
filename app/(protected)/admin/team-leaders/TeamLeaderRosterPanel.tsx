"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { renameTeamLeaderAction, deleteTeamLeaderAction, updateTeamLeaderSupervisorAction } from "./actions";

export interface TeamLeaderRow {
  id: string;
  name: string;
  supervisorId: string | null;
  assignmentCount: number;
}
export interface SupervisorOption {
  id: string;
  name: string;
}

/** Searchable, collapsible list — each Team Leader collapses to a single
 *  clickable banner (name + assignment count + current Supervisor at a
 *  glance) and only expands to show the editable fields (stacked vertically,
 *  not crammed into one wide row) when clicked. Reduces the wall-of-rows
 *  scroll a full roster produced before. Save/Rename/Remove still go through
 *  the same server actions as every other action on this page (redirect back
 *  here with a success/error banner) — this component only owns the
 *  client-side search/expand state, which survives that redirect since it's
 *  a soft navigation (same route, only searchParams change), not a remount. */
export function TeamLeaderRosterPanel({
  teamLeaders,
  supervisors,
  renamingId,
  inputClass,
  labelClass,
}: {
  teamLeaders: TeamLeaderRow[];
  supervisors: SupervisorOption[];
  renamingId?: string;
  inputClass: string;
  labelClass: string;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return teamLeaders;
    return teamLeaders.filter((tl) => tl.name.toLowerCase().includes(needle));
  }, [teamLeaders, query]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const supervisorNameById = new Map(supervisors.map((s) => [s.id, s.name]));

  return (
    <div className="mt-5 flex flex-col gap-2">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search Team Leaders…"
        className={inputClass}
        aria-label="Search Team Leaders"
      />
      <p className="text-[12px] text-muted">
        {query ? `${filtered.length} of ${teamLeaders.length} Team Leader(s)` : `${teamLeaders.length} Team Leader(s)`}
      </p>

      <div className="mt-1 flex flex-col gap-2">
        {filtered.map((tl) => {
          const isOpen = expanded.has(tl.id) || renamingId === tl.id;
          const supervisorLabel = tl.supervisorId ? supervisorNameById.get(tl.supervisorId) : undefined;
          return (
            <div key={tl.id} className="overflow-hidden rounded-xl bg-background-elevated">
              <button
                type="button"
                onClick={() => toggle(tl.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-active"
              >
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {tl.name}
                  <span className="ml-2 text-[13px] text-muted">{tl.assignmentCount} assignment(s)</span>
                  {supervisorLabel ? (
                    <span className="ml-2 text-[13px] text-muted">· reports to {supervisorLabel}</span>
                  ) : (
                    <span className="ml-2 text-[13px] text-accent-amber">· no Supervisor</span>
                  )}
                </span>
                <span className="shrink-0 text-muted-strong">{isOpen ? "−" : "+"}</span>
              </button>

              {isOpen ? (
                <div className="flex flex-col gap-3 border-t border-border/60 px-4 py-3">
                  {renamingId === tl.id ? (
                    <form action={renameTeamLeaderAction} className="flex flex-col gap-2">
                      <input type="hidden" name="teamLeaderId" value={tl.id} />
                      <label className="text-[13px] font-medium text-muted-strong">Name</label>
                      <input name="name" defaultValue={tl.name} className={inputClass} />
                      <div className="flex gap-2">
                        <button type="submit" className="rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-2 text-xs font-semibold text-white">
                          Save name
                        </button>
                        <Link href="/admin/team-leaders" className="rounded-full px-4 py-2 text-xs font-medium text-muted-strong hover:bg-surface">
                          Cancel
                        </Link>
                      </div>
                    </form>
                  ) : (
                    <>
                      <form action={updateTeamLeaderSupervisorAction} className="flex flex-col gap-2">
                        <input type="hidden" name="teamLeaderId" value={tl.id} />
                        <label className="text-[13px] font-medium text-muted-strong">Reports to</label>
                        <select name="supervisorId" defaultValue={tl.supervisorId ?? ""} className={inputClass}>
                          <option value="">— none —</option>
                          {supervisors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="self-start rounded-full bg-background px-4 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft"
                        >
                          Save
                        </button>
                      </form>
                      <div className="flex gap-2 border-t border-border/60 pt-3">
                        <Link
                          href={`/admin/team-leaders?rename=${tl.id}`}
                          className="rounded-full px-4 py-2 text-xs font-medium text-primary-blue hover:bg-accent-blue-soft"
                        >
                          Rename
                        </Link>
                        <form action={deleteTeamLeaderAction} className="inline">
                          <input type="hidden" name="teamLeaderId" value={tl.id} />
                          <button type="submit" className="rounded-full px-4 py-2 text-xs font-medium text-accent-red hover:bg-accent-red-soft">
                            Remove
                          </button>
                        </form>
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
        {filtered.length === 0 ? (
          <p className="text-sm text-muted">
            {teamLeaders.length === 0 ? "No Team Leaders yet — add one above." : "No Team Leaders match your search."}
          </p>
        ) : null}
      </div>
    </div>
  );
}
