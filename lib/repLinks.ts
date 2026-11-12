import { auth } from "@/auth";
import { prisma } from "./db";
import { recomputeDailyTargets, recomputeRepContribution } from "./repContribution";
import { resolveEmployeeIdentities } from "./employeeIdentity";
import { normalizeRepName, REP_SOURCES, type RepSource } from "./repDirectoryBuild";
import {
  buildCellInfo,
  buildLinkContext,
  buildProposals,
  suggestEmployees,
  type CellInfo,
  type DirectoryIdentity,
  type EmployeeSuggestion,
  type LinkConflict,
  type LinkProposal,
  type RosterEmployeeLite,
  type StoredLink,
} from "./repLinkMatch";

// Database side of roster linking (docs/rep-directory-scope.md, phase 2). The matching rules are in repLinkMatch.ts.

// ---- who may edit -----------------------------------------------------------------------------

export interface RosterActor {
  email: string | null;
  isAdmin: boolean;
  teamLeaderId: string | null;
}

/** Admins edit any roster row; a team leader edits the reps on their own roster. Anyone else gets null. */
export async function getRosterActor(): Promise<RosterActor | null> {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;
  if (user.role === "ADMIN") return { email: user.email ?? null, isAdmin: true, teamLeaderId: null };
  if (user.role === "TEAM_LEADER" && user.teamLeaderId) return { email: user.email ?? null, isAdmin: false, teamLeaderId: user.teamLeaderId };
  return null;
}

export async function actorMayEdit(actor: RosterActor, employeeCode: string): Promise<boolean> {
  if (actor.isAdmin) return true;
  const assignment = await prisma.teamLeaderAssignment.findFirst({ where: { teamLeaderId: actor.teamLeaderId!, employeeCode }, select: { id: true } });
  return !!assignment;
}

async function scopedEmployeeCodes(actor: RosterActor): Promise<string[] | null> {
  if (actor.isAdmin) return null;
  const rows = await prisma.teamLeaderAssignment.findMany({ where: { teamLeaderId: actor.teamLeaderId! }, select: { employeeCode: true }, distinct: ["employeeCode"] });
  return rows.map((row) => row.employeeCode);
}

// ---- reading link state -----------------------------------------------------------------------

async function loadIdentities(): Promise<DirectoryIdentity[]> {
  const rows = await prisma.repDirectoryEntry.findMany({
    where: { source: { in: ["SAP", "PINE"] } },
    select: { source: true, sourceKey: true, displayName: true, normalizedName: true, isActive: true },
  });
  return rows;
}

export interface EmployeeCells {
  sap: CellInfo;
  pine: CellInfo;
}

/** The SAP and Pine cell of each employee: linked, name-only (with its one-click proposal) or not linked. */
export async function getEmployeeCells(employees: RosterEmployeeLite[]): Promise<Map<string, EmployeeCells>> {
  const [links, identities, everyone] = await Promise.all([
    prisma.employeeRepLink.findMany({ where: { source: { in: ["SAP", "PINE"] } }, select: { employeeCode: true, source: true, sourceKey: true } }),
    loadIdentities(),
    // Shared-with names need every linked employee, not just the ones on screen.
    prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true } }),
  ]);
  const known = new Map(everyone.map((employee) => [employee.employeeCode, employee as RosterEmployeeLite]));
  for (const employee of employees) known.set(employee.employeeCode, employee);
  const all = Array.from(known.values());
  const sap = buildLinkContext("SAP", all, links, identities);
  const pine = buildLinkContext("PINE", all, links, identities);
  return new Map(employees.map((employee) => [employee.employeeCode, { sap: buildCellInfo(employee, "SAP", sap), pine: buildCellInfo(employee, "PINE", pine) }]));
}

export interface IdentityHit {
  source: RepSource;
  sourceKey: string;
  displayName: string;
  groupLabel: string | null;
  region: string | null;
  principalHint: string | null;
  branch: string | null;
  loginName: string | null;
  isActive: boolean;
  isFieldRep: boolean;
  lastActivityAt: Date | null;
  heldBy: Array<{ employeeCode: string; name: string }>;
}

/** Type-ahead over the directory for one source. With no text it offers the most recently active identities. */
export async function searchIdentities(source: RepSource, q: string, limit = 20): Promise<IdentityHit[]> {
  const text = q.trim();
  const normalized = normalizeRepName(text);
  const entries = await prisma.repDirectoryEntry.findMany({
    where: {
      source,
      ...(text
        ? {
            OR: [
              ...(normalized ? [{ normalizedName: { contains: normalized } }] : []),
              { sourceKey: { contains: text, mode: "insensitive" as const } },
              { loginName: { contains: text, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ isActive: "desc" }, { isFieldRep: "desc" }, { lastActivityAt: { sort: "desc", nulls: "last" } }, { displayName: "asc" }],
    take: Math.min(Math.max(limit, 1), 50),
  });
  const links = await prisma.employeeRepLink.findMany({
    where: { source, sourceKey: { in: entries.map((entry) => entry.sourceKey) } },
    select: { employeeCode: true, sourceKey: true, employee: { select: { pineName: true } } },
  });
  const heldBy = new Map<string, Array<{ employeeCode: string; name: string }>>();
  for (const link of links) heldBy.set(link.sourceKey, [...(heldBy.get(link.sourceKey) ?? []), { employeeCode: link.employeeCode, name: link.employee.pineName }]);
  return entries.map((entry) => ({
    source: entry.source as RepSource,
    sourceKey: entry.sourceKey,
    displayName: entry.displayName,
    groupLabel: entry.groupLabel,
    region: entry.region,
    principalHint: entry.principalHint,
    branch: entry.branch,
    loginName: entry.loginName,
    isActive: entry.isActive,
    isFieldRep: entry.isFieldRep,
    lastActivityAt: entry.lastActivityAt,
    heldBy: heldBy.get(entry.sourceKey) ?? [],
  }));
}

export interface EmployeeHit {
  employeeCode: string;
  name: string;
  sapName: string;
  principal: string;
  active: boolean;
}

/** Roster employees matching typed text, and (given an identity's name) the ones that look like it, for the derived sources' picker. */
export async function searchRosterEmployees(q: string, identityName: string | null, limit = 15): Promise<{ hits: EmployeeHit[]; suggestions: Array<EmployeeSuggestion & { sapName: string; principal: string; active: boolean }> }> {
  const text = q.trim();
  const rows = await prisma.employeeMaster.findMany({
    where: text
      ? {
          OR: [
            { pineName: { contains: text, mode: "insensitive" } },
            { sapName: { contains: text, mode: "insensitive" } },
            { employeeCode: { contains: text, mode: "insensitive" } },
          ],
        }
      : {},
    select: { employeeCode: true, pineName: true, sapName: true, absolutePrincipal: true, active: true },
    orderBy: [{ active: "desc" }, { pineName: "asc" }],
    take: Math.min(Math.max(limit, 1), 40),
  });
  const hits = rows.map((row) => ({ employeeCode: row.employeeCode, name: row.pineName, sapName: row.sapName, principal: row.absolutePrincipal, active: row.active }));
  if (!identityName) return { hits, suggestions: [] };
  const everyone = await prisma.employeeMaster.findMany({ where: { active: true }, select: { employeeCode: true, pineName: true, sapName: true, absolutePrincipal: true, active: true } });
  const byCode = new Map(everyone.map((row) => [row.employeeCode, row]));
  const suggestions = suggestEmployees(identityName, everyone.map((row) => ({ employeeCode: row.employeeCode, pineName: row.pineName, sapName: row.sapName }))).map((suggestion) => ({
    ...suggestion,
    sapName: byCode.get(suggestion.employeeCode)?.sapName ?? "",
    principal: byCode.get(suggestion.employeeCode)?.absolutePrincipal ?? "",
    active: byCode.get(suggestion.employeeCode)?.active ?? true,
  }));
  return { hits, suggestions };
}

// ---- writing links ----------------------------------------------------------------------------

export type SetLinkResult =
  | { ok: true; changed: boolean; nameChanged: boolean; sharedWith: Array<{ employeeCode: string; name: string }>; identityName: string | null }
  | { ok: false; error: string };

function numericKey(key: string): number | null {
  return /^\d+$/.test(key) ? Number(key) : null;
}

/** Links an employee to a directory identity, or removes the link when `sourceKey` is null. For SAP and Pine the identity's own spelling and
 *  code are written to the employee (and the spelling to their Team Leader assignments), so everything that matches by name keeps working.
 *  Every change is logged. The caller runs `afterNameChange()` once when `nameChanged` is true. */
export async function setEmployeeLink(params: { employeeCode: string; source: RepSource; sourceKey: string | null; actor: RosterActor; action?: "ACCEPT_PROPOSAL" }): Promise<SetLinkResult> {
  const { employeeCode, source, sourceKey, actor } = params;
  if (!(REP_SOURCES as readonly string[]).includes(source)) return { ok: false, error: "Unknown source." };
  const employee = await prisma.employeeMaster.findUnique({ where: { employeeCode } });
  if (!employee) return { ok: false, error: "That roster record no longer exists." };
  if (!(await actorMayEdit(actor, employeeCode))) return { ok: false, error: "You can only change links for reps on your own roster." };

  const existing = await prisma.employeeRepLink.findUnique({ where: { employeeCode_source: { employeeCode, source } } });
  const by = actor.email ?? "unknown";

  if (sourceKey === null) {
    if (!existing) return { ok: true, changed: false, nameChanged: false, sharedWith: [], identityName: null };
    const previous = await prisma.repDirectoryEntry.findUnique({ where: { source_sourceKey: { source, sourceKey: existing.sourceKey } }, select: { displayName: true } });
    await prisma.$transaction([
      prisma.employeeRepLink.delete({ where: { id: existing.id } }),
      ...(source === "SAP" ? [prisma.employeeMaster.update({ where: { employeeCode }, data: { sapSlpCode: null } })] : []),
      ...(source === "PINE" ? [prisma.employeeMaster.update({ where: { employeeCode }, data: { pineUserId: null } })] : []),
      prisma.employeeRepLinkChange.create({ data: { employeeCode, source, action: "UNLINK", fromKey: existing.sourceKey, fromName: previous?.displayName ?? null, changedBy: by } }),
    ]);
    return { ok: true, changed: true, nameChanged: false, sharedWith: [], identityName: null };
  }

  const entry = await prisma.repDirectoryEntry.findUnique({ where: { source_sourceKey: { source, sourceKey } } });
  if (!entry) return { ok: false, error: "That rep is not in the directory. Refresh the directory and try again." };

  const sharedWith = (
    await prisma.employeeRepLink.findMany({ where: { source, sourceKey, employeeCode: { not: employeeCode } }, select: { employeeCode: true, employee: { select: { pineName: true } } } })
  ).map((link) => ({ employeeCode: link.employeeCode, name: link.employee.pineName }));

  const textChanged = (source === "SAP" && employee.sapName !== entry.displayName) || (source === "PINE" && employee.pineName !== entry.displayName);
  const unchanged = existing?.sourceKey === sourceKey && !textChanged && (source === "SAP" ? employee.sapSlpCode === numericKey(sourceKey) : source === "PINE" ? employee.pineUserId === numericKey(sourceKey) : true);
  if (unchanged) return { ok: true, changed: false, nameChanged: false, sharedWith, identityName: entry.displayName };

  const previousName = existing ? (await prisma.repDirectoryEntry.findUnique({ where: { source_sourceKey: { source, sourceKey: existing.sourceKey } }, select: { displayName: true } }))?.displayName ?? null : null;
  await prisma.$transaction([
    prisma.employeeRepLink.upsert({
      where: { employeeCode_source: { employeeCode, source } },
      create: { employeeCode, source, sourceKey, linkedBy: by },
      update: { sourceKey, linkedBy: by, linkedAt: new Date() },
    }),
    ...(source === "SAP"
      ? [
          prisma.employeeMaster.update({ where: { employeeCode }, data: { sapName: entry.displayName, sapSlpCode: numericKey(sourceKey) } }),
          prisma.teamLeaderAssignment.updateMany({ where: { employeeCode }, data: { sapName: entry.displayName } }),
        ]
      : []),
    ...(source === "PINE"
      ? [
          prisma.employeeMaster.update({ where: { employeeCode }, data: { pineName: entry.displayName, pineUserId: numericKey(sourceKey) } }),
          prisma.teamLeaderAssignment.updateMany({ where: { employeeCode }, data: { employeeName: entry.displayName } }),
        ]
      : []),
    prisma.employeeRepLinkChange.create({
      data: {
        employeeCode,
        source,
        action: params.action ?? (existing ? "RELINK" : "LINK"),
        fromKey: existing?.sourceKey ?? null,
        fromName: previousName,
        toKey: sourceKey,
        toName: entry.displayName,
        changedBy: by,
      },
    }),
  ]);
  return { ok: true, changed: true, nameChanged: textChanged, sharedWith, identityName: entry.displayName };
}

/** The same recompute every roster edit already runs: a changed name can change which sales belong to which rep. */
export async function afterNameChange(): Promise<void> {
  await recomputeRepContribution();
  await recomputeDailyTargets();
  await resolveEmployeeIdentities();
}

// ---- bulk proposals ---------------------------------------------------------------------------

export interface BulkProposals {
  proposals: LinkProposal[];
  conflicts: LinkConflict[];
}

/** Exact-name matches for employees in the actor's scope, split into ones safe to accept together and ones a person must decide. */
export async function getBulkProposals(actor: RosterActor): Promise<BulkProposals> {
  const codes = await scopedEmployeeCodes(actor);
  const [everyone, links, identities] = await Promise.all([
    prisma.employeeMaster.findMany({ select: { employeeCode: true, pineName: true, sapName: true, active: true } }),
    prisma.employeeRepLink.findMany({ where: { source: { in: ["SAP", "PINE"] } }, select: { employeeCode: true, source: true, sourceKey: true } }),
    loadIdentities(),
  ]);
  // Judged against everyone's links (a holder may be outside the actor's roster); only the actor's own active reps are offered.
  const mine = everyone.filter((employee) => employee.active && (!codes || codes.includes(employee.employeeCode)));
  return buildProposals(mine, links as StoredLink[], identities, everyone);
}

export const proposalToken = (p: { employeeCode: string; source: string; sourceKey: string }) => `${p.employeeCode}|${p.source}|${p.sourceKey}`;

/** Accepts the listed proposals. Each is checked again against today's data, so one that has stopped being a clean exact match is skipped, not forced. */
export async function acceptProposals(actor: RosterActor, tokens: string[]): Promise<{ accepted: number; skipped: number; nameChanged: boolean }> {
  const current = new Map((await getBulkProposals(actor)).proposals.map((p) => [proposalToken(p), p]));
  let accepted = 0;
  let skipped = 0;
  let nameChanged = false;
  for (const token of tokens) {
    const proposal = current.get(token);
    if (!proposal) {
      skipped += 1;
      continue;
    }
    const result = await setEmployeeLink({ employeeCode: proposal.employeeCode, source: proposal.source, sourceKey: proposal.sourceKey, actor, action: "ACCEPT_PROPOSAL" });
    if (result.ok) {
      accepted += 1;
      nameChanged = nameChanged || result.nameChanged;
    } else skipped += 1;
  }
  return { accepted, skipped, nameChanged };
}
