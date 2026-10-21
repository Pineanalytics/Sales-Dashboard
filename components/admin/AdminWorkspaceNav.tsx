"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown20Regular } from "@fluentui/react-icons";

type Role = "ADMIN" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR" | "VIEWER" | "SALES_ADMIN" | "FINANCE_MANAGER" | "ACCOUNTANT" | "LOGISTICS_MANAGER";

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
  { href: "/admin/gp-targets", label: "GP margin targets", group: "Planning", keywords: "gross profit margin target principal brand finance", roles: ["ADMIN"] },
  { href: "/admin/upfield-outlets", label: "Upfield outlet list", group: "Reference", keywords: "upfield outlet customer master channel type route fsr dataedge upload", roles: ["ADMIN"] },
  { href: "/admin/stock-brands", label: "Stock brands", group: "Planning", keywords: "stock brand sku mapping rules item name manufacturer", roles: ["ADMIN"] },
  { href: "/admin/stock-cover", label: "Stock cover targets", group: "Planning", keywords: "stock cover days target standard stock reorder overstock principal brand run rate", roles: ["ADMIN"] },
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
  const [openGroup, setOpenGroup] = useState<(typeof primaryGroups)[number] | null>(null);
  const groupsRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => destinations.filter((item) => item.roles.includes(role)), [role]);
  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? visible.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(term)).slice(0, 6) : [];
  }, [query, visible]);

  // This nav persists across client-side navigation (it's shared layout chrome, not
  // remounted per page), so a dropdown must be closed explicitly on an outside click
  // or a selection — it won't reset itself the way an unmounted <details> would.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (openGroup && event.target instanceof Node && !groupsRef.current?.contains(event.target)) setOpenGroup(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [openGroup]);

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

        <div ref={groupsRef} className="flex flex-wrap gap-2">
          {primaryGroups.map((group) => {
            const items = visible.filter((item) => item.group === group);
            if (items.length === 0) return null;
            const isItemActive = (item: AdminDestination) => (item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname?.startsWith(`${item.href}/`));
            const activeItem = items.find(isItemActive);
            const isOpen = openGroup === group;
            return (
              <div key={group} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenGroup(isOpen ? null : group)}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    activeItem || isOpen ? "bg-primary-blue text-white" : "bg-background-elevated text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                  }`}
                >
                  {group}
                  {activeItem ? <span className="max-w-[9rem] truncate font-normal opacity-90">· {activeItem.label}</span> : null}
                  <ChevronDown20Regular className={`h-3.5 w-3.5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
                {isOpen ? (
                  <div role="menu" className="absolute left-0 top-[calc(100%+0.35rem)] z-10 min-w-[14rem] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                    {items.map((item) => {
                      const active = isItemActive(item);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          role="menuitem"
                          onClick={() => setOpenGroup(null)}
                          className={`block px-4 py-2.5 text-sm transition-colors ${
                            active ? "bg-accent-blue-soft font-semibold text-primary-blue" : "text-foreground hover:bg-background-elevated"
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
