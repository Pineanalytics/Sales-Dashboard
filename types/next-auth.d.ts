import type { DefaultSession } from "next-auth";

export type UserRole = "ADMIN" | "VIEWER";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      allowedPages: string[];
    } & DefaultSession["user"];
  }

  interface User {
    role: UserRole;
    allowedPages: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    allowedPages: string[];
  }
}
