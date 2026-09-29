import { redirect } from "next/navigation";

// JP Adherence is now a tab inside Coverage & Productivity.
export default function JpAdherencePage() {
  redirect("/coverage?tab=jp-adherence");
}
