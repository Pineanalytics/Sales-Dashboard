import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { RoleConfirmationGate } from "./role-confirmation/RoleConfirmationGate";

// Auth is enforced here (page/layout level) rather than in Proxy/Middleware:
// Next.js 16's Proxy convention always runs on the Node.js runtime with no
// way to opt into the Edge runtime, which Cloudflare's OpenNext adapter does
// not support ("Node.js middleware is not currently supported"). Enforcing
// auth in a layout instead works on any deployment target.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Read role/roleConfirmedAt straight from the DB rather than the JWT
  // session, which can be up to five minutes stale (see auth.ts's
  // REFRESH_INTERVAL_MS) — an admin's role change, or this person's own
  // just-submitted confirmation, must take effect on the very next page
  // load, not wait for the token to catch up. ADMIN/DIRECTOR are exempt by
  // design; everyone else is gated until roleConfirmedAt is set once.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, roleConfirmedAt: true, name: true, email: true },
  });
  if (dbUser && dbUser.role !== "ADMIN" && dbUser.role !== "DIRECTOR" && !dbUser.roleConfirmedAt) {
    return <RoleConfirmationGate currentRole={dbUser.role} name={dbUser.name} email={dbUser.email} />;
  }

  return <>{children}</>;
}
