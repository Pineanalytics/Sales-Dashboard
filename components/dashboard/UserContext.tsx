"use client";

import { createContext, useContext } from "react";
import type { Session } from "next-auth";

const UserContext = createContext<Session["user"] | null>(null);

export const UserProvider = UserContext.Provider;

/** Access the signed-in user's session data anywhere under AnalyticsShell,
 *  without re-fetching /api/auth/session client-side. */
export function useCurrentUser(): Session["user"] | null {
  return useContext(UserContext);
}
