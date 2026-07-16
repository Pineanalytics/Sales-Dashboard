import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminDatasetPanel } from "@/components/admin/AdminDatasetPanel";

export const dynamic = "force-dynamic";

export default async function AdminDatasetPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/admin" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to admin
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Dataset</h1>
        <p className="mt-1 text-sm text-white/70">
          Upload the monthly Excel export and browse or restore prior snapshots.
        </p>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-6">
        <AdminDatasetPanel />
      </div>
    </div>
  );
}
