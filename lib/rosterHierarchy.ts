// Pure tree-assembly for the Team Leader -> Sales Supervisor -> Manager ->
// Head of Sales -> Director org hierarchy. Every parent link in the schema
// (TeamLeader.supervisorId, Supervisor.managerId, Manager.hodId,
// Hod.directorId) is a plain string id "by convention", not a Prisma
// relation, so this walks them manually rather than via an `include`.
// Consumed by the admin/team-leaders page to render one consolidated tree
// instead of six separate flat lists — see docs/plans (Roster consolidation).

export interface HierarchyTeamLeader {
  id: string;
  name: string;
  supervisorId: string | null;
}
export interface HierarchySupervisor {
  id: string;
  name: string;
  managerId: string | null;
}
export interface HierarchyManager {
  id: string;
  name: string;
  hodId: string | null;
}
export interface HierarchyHod {
  id: string;
  name: string;
  directorId: string | null;
}
export interface HierarchyDirector {
  id: string;
  name: string;
}

// Generic over each tier's own row shape (intersection, not just the base
// Hierarchy* interface) so a caller can pass extra fields — e.g.
// TeamLeader.visiblePages — and get them back intact on the nested node.
// buildRosterHierarchy only ever reads the id/parent-link fields below; the
// rest passes through untouched.
export type SupervisorNode<TL extends HierarchyTeamLeader = HierarchyTeamLeader, S extends HierarchySupervisor = HierarchySupervisor> = S & {
  teamLeaders: TL[];
};
export type ManagerNode<TL extends HierarchyTeamLeader = HierarchyTeamLeader, S extends HierarchySupervisor = HierarchySupervisor, M extends HierarchyManager = HierarchyManager> = M & {
  supervisors: SupervisorNode<TL, S>[];
};
export type HodNode<
  TL extends HierarchyTeamLeader = HierarchyTeamLeader,
  S extends HierarchySupervisor = HierarchySupervisor,
  M extends HierarchyManager = HierarchyManager,
  H extends HierarchyHod = HierarchyHod,
> = H & { managers: ManagerNode<TL, S, M>[] };
export type DirectorNode<
  TL extends HierarchyTeamLeader = HierarchyTeamLeader,
  S extends HierarchySupervisor = HierarchySupervisor,
  M extends HierarchyManager = HierarchyManager,
  H extends HierarchyHod = HierarchyHod,
  D extends HierarchyDirector = HierarchyDirector,
> = D & { hods: HodNode<TL, S, M, H>[] };

export interface RosterHierarchy<
  TL extends HierarchyTeamLeader = HierarchyTeamLeader,
  S extends HierarchySupervisor = HierarchySupervisor,
  M extends HierarchyManager = HierarchyManager,
  H extends HierarchyHod = HierarchyHod,
  D extends HierarchyDirector = HierarchyDirector,
> {
  directors: DirectorNode<TL, S, M, H, D>[];
  // Every tier below the top can be missing its parent (never assigned, or a
  // dangling id from partial admin setup) — surfaced separately rather than
  // silently dropped, mirroring this codebase's reject-deletes/don't-hide-gaps
  // convention elsewhere (e.g. lib/repContribution.ts's unassignedRevenueReps).
  unassignedHods: HodNode<TL, S, M, H>[];
  unassignedManagers: ManagerNode<TL, S, M>[];
  unassignedSupervisors: SupervisorNode<TL, S>[];
  unassignedTeamLeaders: TL[];
}

function groupByParent<T>(items: T[], parentId: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = parentId(item);
    if (key === null) continue;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

export function buildRosterHierarchy<
  TL extends HierarchyTeamLeader = HierarchyTeamLeader,
  S extends HierarchySupervisor = HierarchySupervisor,
  M extends HierarchyManager = HierarchyManager,
  H extends HierarchyHod = HierarchyHod,
  D extends HierarchyDirector = HierarchyDirector,
>(teamLeaders: TL[], supervisors: S[], managers: M[], hods: H[], directors: D[]): RosterHierarchy<TL, S, M, H, D> {
  const teamLeadersBySupervisor = groupByParent(teamLeaders, (tl) => tl.supervisorId);
  const supervisorsByManager = groupByParent(supervisors, (s) => s.managerId);
  const managersByHod = groupByParent(managers, (m) => m.hodId);
  const hodsByDirector = groupByParent(hods, (h) => h.directorId);

  const validSupervisorIds = new Set(supervisors.map((s) => s.id));
  const validManagerIds = new Set(managers.map((m) => m.id));
  const validHodIds = new Set(hods.map((h) => h.id));
  const validDirectorIds = new Set(directors.map((d) => d.id));

  const supervisorNode = (s: S): SupervisorNode<TL, S> => ({
    ...s,
    teamLeaders: teamLeadersBySupervisor.get(s.id) ?? [],
  });
  const managerNode = (m: M): ManagerNode<TL, S, M> => ({
    ...m,
    supervisors: (supervisorsByManager.get(m.id) ?? []).map(supervisorNode),
  });
  const hodNode = (h: H): HodNode<TL, S, M, H> => ({
    ...h,
    managers: (managersByHod.get(h.id) ?? []).map(managerNode),
  });
  const directorNode = (d: D): DirectorNode<TL, S, M, H, D> => ({
    ...d,
    hods: (hodsByDirector.get(d.id) ?? []).map(hodNode),
  });

  return {
    directors: directors.map(directorNode),
    unassignedHods: hods.filter((h) => !h.directorId || !validDirectorIds.has(h.directorId)).map(hodNode),
    unassignedManagers: managers.filter((m) => !m.hodId || !validHodIds.has(m.hodId)).map(managerNode),
    unassignedSupervisors: supervisors.filter((s) => !s.managerId || !validManagerIds.has(s.managerId)).map(supervisorNode),
    unassignedTeamLeaders: teamLeaders.filter((tl) => !tl.supervisorId || !validSupervisorIds.has(tl.supervisorId)),
  };
}
