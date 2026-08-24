"use client";

import { useEffect, useMemo, useState } from "react";

type UserRole = "ADMIN" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR" | "VIEWER";

type UserSummary = {
  id: string;
  name: string | null;
  email: string;
  role: UserRole;
};

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  TEAM_LEADER: "Team Leader",
  SUPERVISOR: "Sales Supervisor",
  HOD: "Head of Sales",
  DIRECTOR: "Director",
  VIEWER: "Viewer",
};

export function UserAccessToolbar({ users }: { users: UserSummary[] }) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<UserRole | "">("");
  const normalizedQuery = query.trim().toLowerCase();

  const matches = useMemo(
    () =>
      users.filter((user) => {
        const matchesQuery = !normalizedQuery || `${user.name ?? ""} ${user.email}`.toLowerCase().includes(normalizedQuery);
        return matchesQuery && (!role || user.role === role);
      }),
    [normalizedQuery, role, users]
  );

  useEffect(() => {
    for (const row of document.querySelectorAll<HTMLElement>("[data-user-row]")) {
      const rowText = row.dataset.userSearch ?? "";
      const rowRole = row.dataset.userRole ?? "";
      row.hidden = Boolean((normalizedQuery && !rowText.includes(normalizedQuery)) || (role && rowRole !== role));
    }
  }, [normalizedQuery, role]);

  function openUser(userId: string) {
    const row = document.getElementById(`user-${userId}`) as HTMLDetailsElement | null;
    if (!row) return;
    row.open = true;
    row.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function clearFilters() {
    setQuery("");
    setRole("");
  }

  return (
    <section className="sticky top-[7.5rem] z-20 rounded-2xl border border-secondary-blue/20 bg-surface/95 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-primary-blue">Find a user</h2>
          <p className="mt-0.5 text-xs text-muted">Search and open one user&apos;s access settings without scanning the full list.</p>
        </div>
        <span className="text-xs font-medium text-muted-strong">{matches.length} of {users.length} users</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or email…"
          className="rounded-full border border-border bg-background px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-secondary-blue"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole | "")}
          className="rounded-full border border-border bg-background px-4 py-2 text-sm outline-none focus:border-secondary-blue"
          aria-label="Filter users by role"
        >
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {(query || role) ? (
          <button type="button" onClick={clearFilters} className="rounded-full px-3 py-2 text-xs font-semibold text-primary-blue hover:bg-accent-blue-soft">
            Clear filters
          </button>
        ) : null}
      </div>

      {(query || role) ? (
        <div className="mt-3 flex max-h-40 flex-col overflow-y-auto rounded-xl border border-border/70 bg-background">
          {matches.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">No users match these filters.</p>
          ) : (
            matches.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => openUser(user.id)}
                className="flex items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-background-elevated"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{user.name || user.email}</span>
                  {user.name ? <span className="block truncate text-xs text-muted">{user.email}</span> : null}
                </span>
                <span className="shrink-0 text-xs text-muted">{ROLE_LABELS[user.role]}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </section>
  );
}
