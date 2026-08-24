"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

type Role = "ADMIN" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR" | "VIEWER";

type AdminDestination = {
  href: string;
  label: string;
  group: "Workspace" | "People" | "Planning" | "Reference" | "Operations";
  keywords: string;
  roles: Role[];
};

const destinations: AdminDestination[] = [
  { href: "/admin", label: "Admin home", group: "Workspace", keywords: "overview control centre modules", roles: ["ADMIN"] },
  { href: "/admin/users", label: "Users & access", group: "People", keywords: "users accounts permissions approvals roles access", roles: ["ADMIN"] },
  { href: "/admin/team-leaders", label: "Team hierarchy", group: "People", keywords: "team leader supervisor manager roster assignment reps", roles: ["ADMIN", "SUPERVISOR"] },
  { href: "/admin/employee-master", label: "Employee roster", group: "People", keywords: "employee rep pine sap people roster", roles: ["ADMIN", "TEAM_LEADER"] },
  { href: "/admin/targets", label: "Monthly targets", group: "Planning", keywords: "monthly target principal value volume coverage productivity", roles: ["ADMIN"] },
  { href: "/targets-overview", label: "Target workspace", group: "Planning", keywords: "target management weekly projection roster", roles: ["ADMIN", "TEAM_LEADER"] },
  { href: "/weekly-targets", label: "Weekly targets", group: "Planning", keywords: "weekly target plan team leader principal", roles: ["ADMIN", "TEAM_LEADER", "SUPERVISOR"] },
  { href: "/admin/principals", label: "Principals", group: "Reference", keywords: "principal location ownership team leader", roles: ["ADMIN"] },
  { href: "/admin/products", label: "Product master", group: "Reference", keywords: "product item pack size principal", roles: ["ADMIN"] },
  { href: "/admin/warehouses", label: "Warehouses", group: "Reference", keywords: "warehouse location reference", roles: ["ADMIN"] },
  { href: "/admin/key-account-reps", label: "Key account reps", group: "Reference", keywords: "key account rep channel team leader", roles: ["ADMIN"] },
  { href: "/admin/dataset", label: "Data & sync", group: "Operations", keywords: "dataset upload snapshot sync health stock", roles: ["ADMIN"] },
];

const primaryGroups = ["People", "Planning", "Reference", "Operations"] as const;

export function AdminWorkspaceNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => destinations.filter((item) => item.roles.includes(role)), [role]);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? visible.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(term)).slice(0, 6) : [];
  }, [query, visible]);

  return (
    <nav aria-label="Admin workspace" className="sticky top-0 z-30 border-b border-border/70 bg-surface/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-2 px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={role === "ADMIN" ? "/admin" : "/dashboard"} className="shrink-0 text-sm font-bold text-primary-blue">
            Admin workspace
          </Link>
          <div className="relative min-w-[220px] flex-1 sm:max-w-md">
            <label className="sr-only" htmlFor="admin-module-search">Find an admin module</label>
            <input
              id="admin-module-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find people, targets, principals…"
              className="w-full rounded-full border border-border bg-background px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-secondary-blue"
            />
            {results.length > 0 ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                {results.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setQuery("")} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-background-elevated">
                    <span className="font-medium text-foreground">{item.label}</span>
                    <span className="text-xs text-muted">{item.group}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
          <Link href="/dashboard" className="text-xs font-medium text-muted-strong hover:text-primary-blue">Dashboard</Link>
        </div>

        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {primaryGroups.map((group) => {
            const items = visible.filter((item) => item.group === group);
            if (items.length === 0) return null;
            return items.map((item) => {
              const active = item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname?.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    active ? "bg-primary-blue text-white" : "bg-background-elevated text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                  }`}
                >
                  {item.label}
                </Link>
              );
            });
          })}
        </div>
      </div>
    </nav>
  );
}
