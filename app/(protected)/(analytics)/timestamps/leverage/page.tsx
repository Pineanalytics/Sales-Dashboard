import { redirect } from "next/navigation";

// Unilever · Leverage is now reached from inside Coverage & Productivity's
// "Timestamps" tab (via SfaReportNavigator), not its own route.
export default function LeveragePage() {
  redirect("/coverage?tab=timestamps");
}
