"use client";

import { useEffect, useState } from "react";
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
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  BuildingShop20Regular,
  Clock20Regular,
  CalendarCheckmark20Regular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import { useDashboardStore, SIDEBAR_COLLAPSED_KEY } from "@/lib/store";
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
  { href: "/active-outlets", label: "Active Outlets", icon: BuildingShop20Regular },
  { href: "/timestamps", label: "Timestamps", icon: Clock20Regular },
  { href: "/jp-adherence", label: "JP Adherence", icon: CalendarCheckmark20Regular },
  { href: "/reports", label: "Reports", icon: DocumentText20Regular },
];

export function Sidebar({ user }: { user?: Session["user"] | null }) {
  const pathname = usePathname();
  const sidebarOpen = useDashboardStore((s) => s.sidebarOpen);
  const setSidebarOpen = useDashboardStore((s) => s.setSidebarOpen);
  const sidebarCollapsed = useDashboardStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useDashboardStore((s) => s.setSidebarCollapsed);
  // Hovering a collapsed rail temporarily peeks the full width/labels without
  // changing the persisted resting state — only the "pin" toggle button does that.
  const [hovered, setHovered] = useState(false);

  // Restored after mount (not read synchronously at store-creation time) so the first
  // client render matches the server-rendered HTML — avoids a hydration mismatch.
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
      setSidebarCollapsed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAdmin = user?.role === "ADMIN";
  // Admins always see every report; a viewer only sees the pages their admin granted.
  const visibleNavItems = isAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => {
        const key = pageKeyForPathname(item.href);
        return key ? (user?.allowedPages ?? []).includes(key) : true;
      });

  const expanded = !sidebarCollapsed || hovered;

  return (
    <>
      {sidebarOpen ? (
        <button
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}

      {/* Reserves constant flex space at the resting width (driven by sidebarCollapsed,
          not the hover-driven `expanded`), so peeking on hover never reflows the main
          content — only the visually-overlapping <aside> below widens on hover. */}
      <div className={`hidden md:block shrink-0 transition-[width] duration-300 ${sidebarCollapsed ? "md:w-[68px]" : "md:w-72"}`} />

      <aside
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={`fixed z-50 top-0 left-0 h-full w-72 bg-surface flex flex-col transition-[transform,width] duration-300 md:translate-x-0 md:shadow-[2px_0_8px_rgba(0,0,0,0.06)] ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        } ${expanded ? "md:w-72" : "md:w-[68px]"}`}
      >
        <div className="flex items-center justify-between px-4 py-4 md:hidden">
          <span className="font-semibold text-sm text-primary-blue">Menu</span>
          <button onClick={() => setSidebarOpen(false)} aria-label="Close menu" className="text-muted hover:text-foreground">
            <Dismiss20Regular />
          </button>
        </div>

        <div className={`hidden md:flex items-center px-3 pt-3 ${expanded ? "justify-end" : "justify-center"}`}>
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="rounded-full p-1.5 text-muted hover:bg-accent-blue-soft hover:text-primary-blue transition-colors duration-300"
          >
            {sidebarCollapsed ? <PanelLeftExpand20Regular /> : <PanelLeftContract20Regular />}
          </button>
        </div>

        <nav className="px-3 pt-2 flex flex-col gap-1">
          {visibleNavItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                } ${
                  active
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={active ? "text-white" : "text-secondary-blue"}>
                  <Icon />
                </span>
                <span className={expanded ? "" : "md:hidden"}>{label}</span>
              </Link>
            );
          })}
        </nav>

        {isAdmin ? (
          <>
            <div className={`mt-4 px-6 text-[11px] font-semibold uppercase tracking-wide text-muted ${expanded ? "" : "md:hidden"}`}>Admin</div>
            <nav className="px-3 pt-2 flex flex-col gap-1">
              <Link
                href="/admin"
                title="User Management"
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                } ${
                  pathname?.startsWith("/admin")
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={pathname?.startsWith("/admin") ? "text-white" : "text-secondary-blue"}>
                  <Shield20Regular />
                </span>
                <span className={expanded ? "" : "md:hidden"}>User Management</span>
              </Link>
            </nav>
          </>
        ) : null}
      </aside>
    </>
  );
}
