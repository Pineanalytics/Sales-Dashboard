import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { landingPathFor } from "@/lib/pageAccess";

// Lands each login on a page they can actually open: Executive Summary for most people, or for a login that doesn't have it
// (a Sales Rep with one module, a Stores Manager...) their own My Sales or the first module they were given.
export default async function RootPage() {
  const session = await auth();
  redirect(landingPathFor(session?.user.role, session?.user.allowedPages ?? [], Boolean(session?.user.employeeCode)));
}
