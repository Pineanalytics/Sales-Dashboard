import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { CleanupModule } from "@/components/views/outletCleanup/CleanupModule";

export const dynamic = "force-dynamic";

/** The outlet cleanup: its own module, apart from Active Outlets. Team leaders and supervisors work their outlets here; admins review; HOD and Director can view. */
export default async function OutletCleanupPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { section } = await searchParams;
  return <CleanupModule initialSection={section === "open" ? "open" : undefined} />;
}
