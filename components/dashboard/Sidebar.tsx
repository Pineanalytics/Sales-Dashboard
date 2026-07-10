"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Session } from "next-auth";
import {
  Board20Regular,
  ArrowTrending20Regular,
  DataLine20Regular,
  PeopleTeam20Regular,
  PersonCircle20Regular,
  ChartMultiple20Regular,
  Money20Regular,
  Box20Regular,
  DocumentText20Regular,
  Shield20Regular,
  Dismiss20Regular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import { useDashboardStore } from "@/lib/store";
import { pageKeyForPathname } from "@/lib/pageAccess";

interface NavItem {
  href: string;
  label: string;
  icon: FluentIcon;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Executive Overview", icon: Board20Regular },
  { href: "/sales", label: "Sales Performance", icon: ArrowTrending20Regular },
  { href: "/time-intelligence", label: "Time Intelligence", icon: DataLine20Regular },
  { href: "/coverage", label: "Coverage & Productivity", icon: PeopleTeam20Regular },
  { href: "/reps", label: "Rep Performance", icon: PersonCircle20Regular },
  { href: "/customers", label: "Customers & Brands", icon: ChartMultiple20Regular },
  { href: "/profitability", label: "Profitability", icon: Money20Regular },
  { href: "/stock", label: "Stock Balance", icon: Box20Regular },
  { href: "/reports", label: "Reports", icon: DocumentText20Regular },
];

export function Sidebar({ user }: { user?: Session["user"] | null }) {
  const pathname = usePathname();
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  const isAdmin = user?.role === "ADMIN";
  // Admins always see every report; a viewer only sees the pages their admin granted.
  const visibleNavItems = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => {
        const key = pageKeyForPathname(item.href);
        return key ? (user?.allowedPages ?? []).includes(key) : true;
      });

  return (
    <>
      {sidebarOpen ? (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <aside
        className={`fixed z-50 md:z-0 md:static top-0 left-0 h-full md:h-auto w-72 shrink-0 bg-surface flex flex-col transition-transform duration-300 md:translate-x-0 md:shadow-[2px_0_8px_rgba(0,0,0,0.06)] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4 md:hidden">
          <span className="font-semibold text-sm text-primary-blue">Menu</span>
          <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="text-muted hover:text-foreground">
            <Dismiss20Regular />
          </button>
        </div>

        <nav className="px-3 pt-4 flex flex-col gap-1">
          {visibleNavItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  active
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={active ? "text-white" : "text-secondary-blue"}>
                  <Icon />
                </span>
                {label}
              </Link>
            );
          })}
        </nav>

        {isAdmin ? (
          <>
            <div className="mt-4 px-6 text-[11px] font-semibold uppercase tracking-wide text-muted">Admin</div>
            <nav className="px-3 pt-2 flex flex-col gap-1">
              <Link
                href="/admin"
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  pathname?.startsWith("/admin")
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={pathname?.startsWith("/admin") ? "text-white" : "text-secondary-blue"}>
                  <Shield20Regular />
                </span>
                User Management
              </Link>
            </nav>
          </>
        ) : null}
      </aside>
    </>
  );
}
