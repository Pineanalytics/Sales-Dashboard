import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminPage } from "@/components/admin/AdminPage";

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
      { href: "/admin/gp-targets", title: "GP margin targets", description: "Target gross margin by principal brand for the Finance views.", initials: "GM" },
      { href: "/admin/stock-cover", title: "Stock cover targets", description: "Days of cover to aim for, per principal and brand, for the standard stock figures.", initials: "SC" },
      { href: "/admin/upfield-outlets", title: "Upfield outlet list", description: "Upfield's customer master: outlet type, channel, route and GPS.", initials: "UO" },
      { href: "/admin/stock-brands", title: "Stock brands", description: "How each SKU is named a brand for the Stock screens, with your own rules.", initials: "SB" },
      { href: "/admin/unilever-kpis", title: "Unilever KPI setup", description: "PJP sales targets and the core assortment SKU basket.", initials: "UK" },
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
    <AdminPage
      title="Admin"
      description="Find any control area from the workspace tabs above, or start with a connected workstream below."
      back={{ href: "/", label: "Back to dashboard" }}
      stats={[{ label: "admin areas", value: SECTIONS.reduce((n, section) => n + section.links.length, 0) }]}
    >
      <div className="grid grid-cols-1 items-start gap-4 2xl:grid-cols-3">
        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded-2xl bg-surface p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)] md:p-5">
            <div className="mb-3">
              <h2 className="text-base font-bold text-primary-blue">{section.title}</h2>
              <p className="text-xs text-muted">{section.description}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-1">
              {section.links.map(({ href, title, description, initials }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-start gap-3 rounded-xl border border-border/70 bg-background px-3 py-2.5 transition-all hover:border-secondary-blue/40 hover:shadow-cyan-glow"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-blue-soft text-[11px] font-bold text-accent-blue">{initials}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-primary-blue">{title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AdminPage>
  );
}
