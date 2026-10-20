import type { DefaultSession } from "next-auth";

export type UserRole =
  | "ADMIN"
  | "VIEWER"
  | "TEAM_LEADER"
  | "SUPERVISOR"
  | "HOD"
  | "DIRECTOR"
  | "SALES_ADMIN"
  | "FINANCE_MANAGER"
  | "ACCOUNTANT"
  | "LOGISTICS_MANAGER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      allowedPages: string[];
      teamLeaderId: string | null;
      /** SUPERVISOR-only — links to their Supervisor row, mirrors teamLeaderId. */
      supervisorId: string | null;
      /** VIEWER-and-the-4-back-office-roles principal restriction — see
       *  User.allowedPrincipals. Empty for ADMIN/TEAM_LEADER/SUPERVISOR and for
       *  an unrestricted VIEWER/SALES_ADMIN/FINANCE_MANAGER/ACCOUNTANT/LOGISTICS_MANAGER. */
      allowedPrincipals: string[];
      /** Optional link to EmployeeMaster.employeeCode — see User.employeeCode.
       *  Independent of role; null unless an admin set it. */
      employeeCode: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    allowedPages: string[];
    teamLeaderId: string | null;
    supervisorId: string | null;
    allowedPrincipals: string[];
    employeeCode: string | null;
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
    employeeCode: string | null;
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
