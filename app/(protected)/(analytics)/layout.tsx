import { AnalyticsShell } from "@/components/dashboard/AnalyticsShell";
import { getLatestSnapshot, filterDatasetToPrincipals } from "@/lib/datasetStore";
import { auth } from "@/auth";
import { resolveScopeForSession } from "@/lib/teamLeaderScope";
import { normalizePrincipalKey } from "@/lib/normalize";

export const dynamic = "force-dynamic";

// AnalyticsShell's client-side refresh (via /api/dataset, already scoped) only
// fires on a pathname CHANGE or the 3-minute interval — it's deliberately
// skipped on the very first render (see its isFirstRender guard), so every
// fresh page load/hard refresh relies entirely on the SSR dataset built here.
// Without scoping it too, a TEAM_LEADER would see the full company-wide
// dataset until their second client-side navigation.
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const [dataset, session] = await Promise.all([getLatestSnapshot().catch(() => null), auth()]);

  let scopedDataset = dataset;
  if (dataset && session?.user) {
    const scope = await resolveScopeForSession(session.user.role, session.user.teamLeaderId);
    if (scope) {
      const principalKeys = new Set(scope.principals.map(normalizePrincipalKey));
      scopedDataset = filterDatasetToPrincipals(dataset, principalKeys);
    }
  }

  return (
    <AnalyticsShell initialDataset={scopedDataset} user={session?.user ?? null}>
      {children}
    </AnalyticsShell>
  );
}
