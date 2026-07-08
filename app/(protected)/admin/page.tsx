import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// Plain initials instead of an icon library — @fluentui/react-icons components
// require a Client Component context (used fine in Header.tsx, which is
// "use client"), but this landing page is a server component and has no need
// for client interactivity otherwise.
const SECTIONS = [
  { href: "/admin/users", title: "Users", description: "Create admin or viewer accounts.", initials: "US" },
  { href: "/admin/targets", title: "Targets", description: "Upload monthly targets by principal.", initials: "TG" },
  { href: "/admin/products", title: "Product Master", description: "Item → principal/pack-size reference data.", initials: "PM" },
  { href: "/admin/warehouses", title: "Warehouses", description: "Warehouse → location reference data.", initials: "WH" },
  { href: "/admin/key-account-reps", title: "Key Account Reps", description: "Rep → channel/team-leader reference data.", initials: "KA" },
];

export default async function AdminLandingPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(10,31,82,0.25)]">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Admin</h1>
        <p className="mt-1 text-sm text-white/70">Manage users and reference data for the Pinefrost Limited Performance Dashboard.</p>
      </div>

      <div className="max-w-4xl mx-auto p-4 md:p-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map(({ href, title, description, initials }) => (
          <Link
            key={href}
            href={href}
            className="rounded-2xl bg-surface p-6 shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:shadow-cyan-glow transition-all duration-300 flex items-start gap-4"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-blue-soft text-accent-blue text-xs font-bold">
              {initials}
            </span>
            <span>
              <span className="block text-base font-semibold text-primary-blue">{title}</span>
              <span className="block mt-1 text-[13px] text-muted">{description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
