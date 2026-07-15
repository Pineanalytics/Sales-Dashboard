import type { DefaultSession } from "next-auth";

export type UserRole = "ADMIN" | "VIEWER" | "TEAM_LEADER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      allowedPages: string[];
      teamLeaderId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    allowedPages: string[];
    teamLeaderId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    allowedPages: string[];
    teamLeaderId: string | null;
  }
}
