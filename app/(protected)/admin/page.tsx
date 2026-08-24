import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// Plain initials instead of an icon library — @fluentui/react-icons components
// require a Client Component context (used fine in Header.tsx, which is
// "use client"), but this landing page is a server component and has no need
// for client interactivity otherwise.
const SECTIONS = [
  {
    title: "People & territory",
    description: "Move through the reporting chain without losing context.",
    links: [
      { href: "/admin/users", title: "Users & access", description: "Approve accounts, set roles and report access.", initials: "US" },
      { href: "/admin/team-leaders", title: "Team hierarchy", description: "Filter reps by principal, Team Leader, Supervisor or Manager.", initials: "TH" },
      { href: "/admin/employee-master", title: "Employee roster", description: "Search Pine/SAP identity and ownership records.", initials: "ER" },
    ],
  },
  {
    title: "Targets & planning",
    description: "Use the planning tools in the order targets are set and allocated.",
    links: [
      { href: "/admin/targets", title: "Monthly targets", description: "Upload and amend targets by principal.", initials: "MT" },
      { href: "/targets-overview", title: "Target workspace", description: "Review monthly, weekly and roster plans together.", initials: "TW" },
      { href: "/weekly-targets", title: "Weekly targets", description: "Set Team Leader weekly projections.", initials: "WT" },
    ],
  },
  {
    title: "Reference & data operations",
    description: "Maintain the shared records that make reporting and attribution reliable.",
    links: [
      { href: "/admin/principals", title: "Principals", description: "Location and Team Leader ownership.", initials: "PR" },
      { href: "/admin/products", title: "Product master", description: "Item, principal and pack-size reference.", initials: "PM" },
      { href: "/admin/warehouses", title: "Warehouses", description: "Warehouse and location reference.", initials: "WH" },
      { href: "/admin/key-account-reps", title: "Key account reps", description: "Channel and Team Leader reference.", initials: "KA" },
      { href: "/admin/dataset", title: "Data & sync", description: "Snapshots, uploads and sync health.", initials: "DS" },
    ],
  },
];

export default async function AdminLandingPage() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-gradient-to-br from-dark-navy to-primary-blue px-4 md:px-8 py-6 md:py-7 shadow-[0_2px_10px_rgba(11,61,53,0.25)]">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-medium text-white/80 hover:text-brand-orange transition-colors">
          ← Back to dashboard
        </Link>
        <h1 className="mt-3 text-[26px] md:text-[34px] font-bold text-white leading-tight">Admin</h1>
        <p className="mt-1 text-sm text-white/70">Find any control area from the persistent workspace tabs, or start with a connected workstream below.</p>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8">
        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] md:p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-bold text-primary-blue">{section.title}</h2>
              <p className="text-xs text-muted">{section.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {section.links.map(({ href, title, description, initials }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex min-h-[88px] items-start gap-3 rounded-xl border border-border/70 bg-background p-4 transition-all hover:border-secondary-blue/40 hover:shadow-cyan-glow"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-blue-soft text-[11px] font-bold text-accent-blue">{initials}</span>
                  <span>
                    <span className="block text-sm font-semibold text-primary-blue">{title}</span>
                    <span className="mt-1 block text-xs leading-relaxed text-muted">{description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
