"use client";

import type { ReactNode } from "react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="ops-page-shell">{children}</div>;
}
