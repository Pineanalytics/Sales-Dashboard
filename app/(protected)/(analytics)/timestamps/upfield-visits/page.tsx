import { redirect } from "next/navigation";

// Upfield Outlet Visits is now reached from inside Coverage & Productivity's
// "Timestamps" tab (via UpfieldReportTabs), not its own route.
export default function UpfieldVisitsPage() {
  redirect("/coverage?tab=timestamps");
}
