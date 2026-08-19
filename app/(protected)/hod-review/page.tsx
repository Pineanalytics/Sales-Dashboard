import { redirect } from "next/navigation";
import { auth } from "@/auth";
import HodTrackerClient from "./HodTrackerClient";

export const dynamic = "force-dynamic";

// Built from HEAD OF SALES REVIEW-Suntory.xlsx's "MD Performance Review"
// sheet — company-wide (no Team Leader scoping), one tracker per period.
// HOD fills the KPI values; DIRECTOR/ADMIN review (status + comments) —
// see lib/performanceTracker/definitions.ts and the API route
// (app/api/performance-tracker/route.ts) for where those permissions are
// actually enforced server-side; this page's own role check is just the
// first gate.
export default async function HodReviewPage() {
  const session = await auth();
  if (!session?.user || !["HOD", "DIRECTOR", "ADMIN"].includes(session.user.role)) {
    redirect("/");
  }
  const role = session.user.role;
  return <HodTrackerClient canEditValues={role === "HOD" || role === "ADMIN"} canReview={role === "DIRECTOR" || role === "ADMIN"} />;
}
