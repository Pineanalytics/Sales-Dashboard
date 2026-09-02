"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Session } from "next-auth";
import {
  ArrowTrending20Regular,
  PeopleTeam20Regular,
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
  TargetArrow20Regular,
  Sparkle20Regular,
  Lightbulb20Regular,
  Table20Regular,
  VehicleTruck20Regular,
  Archive20Regular,
  ArrowSwap20Regular,
} from "@fluentui/react-icons";
import type { FluentIcon } from "@fluentui/react-icons";
import { useDashboardStore, SIDEBAR_COLLAPSED_KEY } from "@/lib/store";
import { pageKeyForPathname } from "@/lib/pageAccess";
import { canAccessPerformanceTracker } from "@/lib/performanceTracker/access";

interface NavItem {
  href: string;
  label: string;
  icon: FluentIcon;
}

// Frost + Insights lead the list (quick, AI-assisted entry points, grouped
// near the Header's History control) — the rest of the report pages follow
// in their original order.
const NAV_ITEMS: NavItem[] = [
  { href: "/frost", label: "Frost", icon: Sparkle20Regular },
  { href: "/insights", label: "Insights", icon: Lightbulb20Regular },
  { href: "/sales", label: "Sales Performance", icon: ArrowTrending20Regular },
  { href: "/coverage", label: "Coverage & Productivity", icon: PeopleTeam20Regular },
  { href: "/profitability", label: "Profitability", icon: Money20Regular },
  { href: "/receivables", label: "Receivables & Ageing", icon: Money20Regular },
  { href: "/stock", label: "Stock Balance", icon: Box20Regular },
  { href: "/dormant-stock", label: "Dormant OOS", icon: Archive20Regular },
  { href: "/active-outlets", label: "Active Outlets", icon: BuildingShop20Regular },
  { href: "/timestamps", label: "Timestamps", icon: Clock20Regular },
  { href: "/jp-adherence", label: "JP Adherence", icon: CalendarCheckmark20Regular },
  { href: "/order-360", label: "Order 360", icon: VehicleTruck20Regular },
  { href: "/principal-kpis", label: "Principal KPIs", icon: TargetArrow20Regular },
  { href: "/sales-returns", label: "Sales & Returns", icon: ArrowSwap20Regular },
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
  const isTeamLeader = user?.role === "TEAM_LEADER";
  const isSupervisor = user?.role === "SUPERVISOR";
  const isHod = user?.role === "HOD";
  const isDirector = user?.role === "DIRECTOR";
  const canAccessCoaching = isAdmin || isTeamLeader || isSupervisor;
  const canAccessHodReview = (isAdmin || isHod || isDirector) && canAccessPerformanceTracker(user?.role ?? "");
  const canAccessTlReview = (isAdmin || isTeamLeader || isSupervisor) && canAccessPerformanceTracker(user?.role ?? "");
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

        {canAccessCoaching ? (
          <>
            <div className={`mt-4 px-6 text-[11px] font-semibold uppercase tracking-wide text-muted ${expanded ? "" : "md:hidden"}`}>Field execution</div>
            <nav className="px-3 pt-2 flex flex-col gap-1">
              <Link
                href="/coaching"
                title="Coaching & Accompaniment"
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                } ${
                  pathname?.startsWith("/coaching")
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={pathname?.startsWith("/coaching") ? "text-white" : "text-secondary-blue"}>
                  <PeopleTeam20Regular />
                </span>
                <span className={expanded ? "" : "md:hidden"}>Coaching & Accompaniment</span>
              </Link>
            </nav>
            <div className={`mt-4 px-6 text-[11px] font-semibold uppercase tracking-wide text-muted ${expanded ? "" : "md:hidden"}`}>Targets</div>
            <nav className="px-3 pt-2 flex flex-col gap-1">
              <Link
                href="/weekly-targets"
                title="Weekly Targets"
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                } ${
                  pathname?.startsWith("/weekly-targets")
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={pathname?.startsWith("/weekly-targets") ? "text-white" : "text-secondary-blue"}>
                  <TargetArrow20Regular />
                </span>
                <span className={expanded ? "" : "md:hidden"}>Weekly Targets</span>
              </Link>
              <Link
                href="/targets-overview"
                title="Targets Overview"
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                  expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                } ${
                  pathname?.startsWith("/targets-overview")
                    ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                    : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                }`}
              >
                <span className={pathname?.startsWith("/targets-overview") ? "text-white" : "text-secondary-blue"}>
                  <Table20Regular />
                </span>
                <span className={expanded ? "" : "md:hidden"}>Targets Overview</span>
              </Link>
              {isAdmin || isSupervisor ? (
                <Link
                  href="/admin/team-leaders"
                  title="Roster Management"
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                    expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                  } ${
                    pathname?.startsWith("/admin/team-leaders")
                      ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                      : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                  }`}
                >
                  <span className={pathname?.startsWith("/admin/team-leaders") ? "text-white" : "text-secondary-blue"}>
                    <PeopleTeam20Regular />
                  </span>
                  <span className={expanded ? "" : "md:hidden"}>Roster Management</span>
                </Link>
              ) : null}
              {isTeamLeader ? (
                <Link
                  href="/admin/employee-master"
                  title="My Rep Roster"
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                    expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                  } ${
                    pathname?.startsWith("/admin/employee-master")
                      ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                      : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                  }`}
                >
                  <span className={pathname?.startsWith("/admin/employee-master") ? "text-white" : "text-secondary-blue"}>
                    <PeopleTeam20Regular />
                  </span>
                  <span className={expanded ? "" : "md:hidden"}>My Rep Roster</span>
                </Link>
              ) : null}
            </nav>
          </>
        ) : null}

        {canAccessHodReview || canAccessTlReview ? (
          <>
            <div className={`mt-4 px-6 text-[11px] font-semibold uppercase tracking-wide text-muted ${expanded ? "" : "md:hidden"}`}>Performance Review</div>
            <nav className="px-3 pt-2 flex flex-col gap-1">
              {canAccessHodReview ? (
                <Link
                  href="/hod-review"
                  title="HOD Performance Tracker"
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                    expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                  } ${
                    pathname?.startsWith("/hod-review")
                      ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                      : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                  }`}
                >
                  <span className={pathname?.startsWith("/hod-review") ? "text-white" : "text-secondary-blue"}>
                    <TargetArrow20Regular />
                  </span>
                  <span className={expanded ? "" : "md:hidden"}>HOD Performance Tracker</span>
                </Link>
              ) : null}
              {canAccessTlReview ? (
                <Link
                  href="/tl-review"
                  title="TL Performance Tracker"
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-300 ${
                    expanded ? "" : "md:justify-center md:px-0 md:w-11 md:mx-auto"
                  } ${
                    pathname?.startsWith("/tl-review")
                      ? "bg-gradient-to-r from-primary-blue to-secondary-blue text-white shadow-cyan-glow"
                      : "text-muted-strong hover:bg-accent-blue-soft hover:text-primary-blue"
                  }`}
                >
                  <span className={pathname?.startsWith("/tl-review") ? "text-white" : "text-secondary-blue"}>
                    <Table20Regular />
                  </span>
                  <span className={expanded ? "" : "md:hidden"}>TL Performance Tracker</span>
                </Link>
              ) : null}
            </nav>
          </>
        ) : null}

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
