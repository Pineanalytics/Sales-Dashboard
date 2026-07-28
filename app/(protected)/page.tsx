import { redirect } from "next/navigation";

// Every role (including TEAM_LEADER, since createUserAction/approveUserAction
// already default allowedPages to every page and Sidebar.tsx/AnalyticsShell.tsx
// already gate dashboard content by allowedPages generically, not VIEWER-only)
// lands on the Executive Overview — the Sidebar's separate "Targets" section
// (shown for isAdmin || isTeamLeader, unconditional on allowedPages) still gives
// Team Leaders one click to Weekly Targets from there.
export default async function RootPage() {
  redirect("/dashboard");
}
