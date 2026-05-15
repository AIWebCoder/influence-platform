"use client";

import { useCurrentUser, type AppRole } from "@/lib/auth";

type Props = {
  /** Minimum role required to render the children (defaults to "admin"). */
  minRole?: AppRole;
  /** Optional fallback shown when the user does not meet the role bar. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
};

/** Renders its children only when the current session user meets the required role. */
export function AdminOnly({ minRole = "admin", fallback = null, children }: Props) {
  const { status, hasAtLeast } = useCurrentUser();
  if (status !== "authenticated") return <>{fallback}</>;
  if (!hasAtLeast(minRole)) return <>{fallback}</>;
  return <>{children}</>;
}
