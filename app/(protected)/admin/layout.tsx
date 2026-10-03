import { auth } from "@/auth";
import { AdminWorkspaceNav } from "@/components/admin/AdminWorkspaceNav";
import { AdminScrollKeeper } from "@/components/admin/AdminScrollKeeper";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) return children;

  return (
    <>
      <AdminWorkspaceNav role={session.user.role} />
      <AdminScrollKeeper />
      {children}
    </>
  );
}
