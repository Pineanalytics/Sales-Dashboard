import { redirect } from "next/navigation";
import { auth } from "@/auth";

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
  return <>{children}</>;
}
