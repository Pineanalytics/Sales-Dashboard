import { AnalyticsShell } from "@/components/dashboard/AnalyticsShell";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// The full portfolio dataset is over 100MB and Next's data cache rejects it.
// Loading it in this shared SSR layout delayed every route, including compact
// source-backed pages. AnalyticsShell now requests the scoped data only after
// its navigation chrome has rendered, and only for pages that need it.
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <AnalyticsShell initialDataset={null} user={session?.user ?? null}>
      {children}
    </AnalyticsShell>
  );
}
