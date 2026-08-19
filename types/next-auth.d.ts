import type { DefaultSession } from "next-auth";

export type UserRole = "ADMIN" | "VIEWER" | "TEAM_LEADER" | "SUPERVISOR" | "HOD" | "DIRECTOR";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      allowedPages: string[];
      teamLeaderId: string | null;
      /** SUPERVISOR-only — links to their Supervisor row, mirrors teamLeaderId. */
      supervisorId: string | null;
      /** VIEWER-only principal restriction — see User.allowedPrincipals. Empty for
       *  ADMIN/TEAM_LEADER/SUPERVISOR and for an unrestricted VIEWER. */
      allowedPrincipals: string[];
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    allowedPages: string[];
    teamLeaderId: string | null;
    supervisorId: string | null;
    allowedPrincipals: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    allowedPages: string[];
    teamLeaderId: string | null;
    supervisorId: string | null;
    allowedPrincipals: string[];
    /** Unix ms timestamp of the last DB re-check — see auth.ts's jwt() callback.
     *  Without this, role/allowedPages/status changes an admin makes never reach
     *  an already-signed-in user until they log out and back in. */
    lastRefresh?: number;
    /** Set when the periodic re-check finds the account deleted or no longer
     *  APPROVED — session() drops session.user so the protected layout's
     *  `if (!session?.user) redirect("/login")` kicks the user out on their
     *  next navigation, without waiting for the JWT to naturally expire. */
    revoked?: boolean;
  }
}
