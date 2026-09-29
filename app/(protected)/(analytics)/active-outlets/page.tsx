import { redirect } from "next/navigation";

// Active Outlets is now a tab inside Coverage & Productivity.
export default function ActiveOutletsPage() {
  redirect("/coverage?tab=active-outlets");
}
