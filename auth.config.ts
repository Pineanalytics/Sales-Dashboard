import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "./types/next-auth";

/**
 * Auth config shared by both the full auth.ts (used in Server Components and
 * API routes) and proxy.ts (Next.js's Proxy/Middleware layer) — kept free of
 * Prisma/bcrypt imports so it stays lightweight wherever it's loaded.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isLoginPage = nextUrl.pathname === "/login";
      const isAdminRoute = nextUrl.pathname.startsWith("/admin");
      const isApiRoute = nextUrl.pathname.startsWith("/api/");

      if (isLoginPage) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl));
        return true;
      }
      if (!isLoggedIn) {
        if (isApiRoute) return Response.json({ error: "Sign in required." }, { status: 401 });
        return false; // triggers the default redirect to the sign-in page
      }
      if (isAdminRoute && auth.user.role !== "ADMIN") {
        if (isApiRoute) return Response.json({ error: "Forbidden." }, { status: 403 });
        return Response.redirect(new URL("/", nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
  },
};
