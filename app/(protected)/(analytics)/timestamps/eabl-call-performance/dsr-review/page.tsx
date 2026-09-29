import { redirect } from "next/navigation";

// EABL DSR Review is now reached from inside Coverage & Productivity's
// "Timestamps" tab (via EablReportTabs), not its own route.
export default function EablDsrReviewPage() {
  redirect("/coverage?tab=timestamps");
}
