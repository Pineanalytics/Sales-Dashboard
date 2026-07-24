import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import type { UserRole } from "@/types/next-auth";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // how often jwt() re-checks role/allowedPages/status against the DB

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // Defense in depth: app/login/page.tsx already redirects unapproved accounts
        // before reaching signIn(), with a friendlier "pending approval" message — this
        // is the actual security boundary in case that pre-check is ever bypassed.
        if (user.status !== "APPROVED") return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          allowedPages: user.allowedPages,
          teamLeaderId: user.teamLeaderId,
        };
      },
    }),
  ],
  callbacks: {
    // Without this, an admin changing someone's role/page access (or approving/
    // rejecting an account) never reaches an already-signed-in user until they
    // log out and back in — the JWT strategy otherwise trusts whatever it was
    // issued with for the full session (NextAuth's default maxAge is 30 days).
    // Re-checking the DB on every single request would be wasteful, so this
    // only re-fetches once the token is more than REFRESH_INTERVAL_MS old.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.allowedPages = user.allowedPages;
        token.teamLeaderId = user.teamLeaderId;
        token.lastRefresh = Date.now();
        return token;
      }

      const lastRefresh = (token.lastRefresh as number | undefined) ?? 0;
      if (Date.now() - lastRefresh < REFRESH_INTERVAL_MS) {
        return token;
      }

      const dbUser = await prisma.user.findUnique({ where: { id: token.id as string } });
      if (!dbUser || dbUser.status !== "APPROVED") {
        token.revoked = true;
        return token;
      }

      token.role = dbUser.role;
      token.allowedPages = dbUser.allowedPages;
      token.teamLeaderId = dbUser.teamLeaderId;
      token.lastRefresh = Date.now();
      return token;
    },
    session({ session, token }) {
      if (token.revoked) {
        return { ...session, user: undefined as never, expires: session.expires };
      }
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.allowedPages = token.allowedPages as string[];
        session.user.teamLeaderId = token.teamLeaderId as string | null;
      }
      return session;
    },
  },
});
