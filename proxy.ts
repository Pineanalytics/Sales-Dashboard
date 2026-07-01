import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  // Protect everything except NextAuth's own API routes, static assets, and the favicon.
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
