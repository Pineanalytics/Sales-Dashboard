import { redirect } from "next/navigation";

// EABL Call Performance is now reached from inside Coverage & Productivity's
// "Timestamps" tab (via SfaReportNavigator/EablReportTabs), not its own route.
export default function EablCallPerformancePage() {
  redirect("/coverage?tab=timestamps");
}
