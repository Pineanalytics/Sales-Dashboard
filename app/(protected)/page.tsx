import { redirect } from "next/navigation";
import { auth } from "@/auth";

export default async function RootPage() {
  const session = await auth();
  // Team Leaders have no report-page access by default (allowedPages only matters
  // for VIEWER) — send them straight to the tool they actually use instead of a
  // blocked report page.
  if (session?.user?.role === "TEAM_LEADER") {
    redirect("/weekly-targets");
  }
  redirect("/dashboard");
}
