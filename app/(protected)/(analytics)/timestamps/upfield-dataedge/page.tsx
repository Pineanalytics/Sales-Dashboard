import { redirect } from "next/navigation";

// Upfield DataEdge is now reached from inside Coverage & Productivity's
// "Timestamps" tab (via SfaReportNavigator/UpfieldReportTabs), not its own route.
export default function UpfieldTimestampPage() {
  redirect("/coverage?tab=timestamps");
}
