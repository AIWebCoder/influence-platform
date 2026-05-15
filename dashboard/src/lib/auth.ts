"use client";

import { useSession } from "next-auth/react";

export type AppRole = "admin" | "operator" | "viewer";

const ROLE_RANK: Record<AppRole, number> = {
  admin: 3,
  operator: 2,
  viewer: 1,
};

function normalize(role: string | null | undefined): AppRole {
  if (role === "admin" || role === "operator" || role === "viewer") return role;
  return "viewer";
}

export function useCurrentUser() {
  const { data: session, status } = useSession();
  const email = session?.user?.email ?? null;
  const role = normalize(session?.user?.role as string | undefined);
  return {
    status,
    email,
    role,
    isAuthenticated: status === "authenticated",
    isAdmin: role === "admin",
    isOperator: role === "operator",
    hasAtLeast: (target: AppRole) => ROLE_RANK[role] >= ROLE_RANK[target],
  };
}
