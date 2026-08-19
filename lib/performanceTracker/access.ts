// Temporary gate while both trackers are still being built/refined — only
// ADMIN can reach them right now, even though the real HOD/DIRECTOR/
// TEAM_LEADER/SUPERVISOR permission logic (definitions.ts, the API route,
// both page.tsx files) is already fully wired and tested underneath. Flip
// this back to false once the build is ready to open up to those roles for
// real — every call site below reads this one flag, nothing else needs to
// change.
export const ADMIN_ONLY_WHILE_BUILDING = true;

export function canAccessPerformanceTracker(role: string): boolean {
  if (ADMIN_ONLY_WHILE_BUILDING) return role === "ADMIN";
  return ["ADMIN", "HOD", "DIRECTOR", "TEAM_LEADER", "SUPERVISOR"].includes(role);
}
