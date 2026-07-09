import { AnalyticsShell } from "@/components/dashboard/AnalyticsShell";
import { getLatestSnapshot } from "@/lib/datasetStore";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const [dataset, session] = await Promise.all([getLatestSnapshot().catch(() => null), auth()]);
  return (
    <AnalyticsShell initialDataset={dataset} user={session?.user ?? null}>
      {children}
    </AnalyticsShell>
  );
}
