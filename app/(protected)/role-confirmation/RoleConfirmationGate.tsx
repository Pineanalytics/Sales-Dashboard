import { submitRoleConfirmationAction } from "./actions";

const ROLE_LABELS: Record<string, string> = {
  VIEWER: "Viewer — I just need to view reports",
  TEAM_LEADER: "Team Leader",
  SUPERVISOR: "Sales Supervisor",
  HOD: "Head of Sales",
  DIRECTOR: "Director",
};

// Replaces the whole (protected) layout body for anyone whose role isn't
// ADMIN or DIRECTOR and who hasn't confirmed their role yet (see
// prisma/schema.prisma's User.roleConfirmedAt and this layout's own
// comment) — nothing else renders underneath, so there's no page content
// or data fetch to block separately. Submitting only records a request
// (User.proposedRole) for an admin to approve or dismiss on /admin/users;
// it never changes the real role itself.
export function RoleConfirmationGate({ currentRole, name, email }: { currentRole: string; name: string | null; email: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-surface to-surface-active px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-[0_14px_34px_rgba(11,61,53,0.14)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-secondary-blue">Pinefrost Analytics</p>
        <h1 className="mt-1 text-2xl font-bold text-primary-blue">Confirm your role</h1>
        <p className="mt-1 text-sm text-muted">
          Hi {name || email} — before you continue, confirm the role that best describes you so your access stays accurate.
        </p>

        <form action={submitRoleConfirmationAction} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="role" className="text-[13px] font-medium text-muted-strong">
              Your role
            </label>
            <select
              id="role"
              name="role"
              required
              defaultValue={currentRole in ROLE_LABELS ? currentRole : ""}
              className="rounded-full border border-border bg-surface px-4 py-2 text-sm text-foreground outline-none transition-colors focus:border-secondary-blue"
            >
              {!(currentRole in ROLE_LABELS) ? (
                <option value="" disabled>
                  Select the role that best describes you
                </option>
              ) : null}
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted">A request only — an administrator confirms your actual role and access.</span>
          </div>

          <button
            type="submit"
            className="mt-2 rounded-full bg-gradient-to-r from-primary-blue to-secondary-blue px-4 py-3 text-sm font-semibold text-white transition-all duration-300 hover:shadow-cyan-glow"
          >
            Submit
          </button>
        </form>
      </div>
    </div>
  );
}
