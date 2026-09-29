import { redirect } from "next/navigation";

// Timestamps (Pine hub + EABL/Upfield/Unilever) is now a tab inside Coverage
// & Productivity, reached entirely through client-side module state rather
// than its own routes.
export default function TimestampsPage() {
  redirect("/coverage?tab=timestamps");
}
