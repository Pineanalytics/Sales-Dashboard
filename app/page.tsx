import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getLatestSnapshot } from "@/lib/datasetStore";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [dataset, session] = await Promise.all([
    getLatestSnapshot().catch(() => null),
    auth(),
  ]);
  return <DashboardShell initialDataset={dataset} user={session?.user ?? null} />;
}
