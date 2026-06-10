"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { usePathname } from "next/navigation";

import { isPublicRoute } from "@/lib/legal";

const DashboardChrome = dynamic(() =>
  import("@/components/layout/DashboardChrome").then((m) => m.DashboardChrome),
);

function LayoutClientBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isPublicRoute(pathname)) {
    return (
      <main className="w-full min-h-0 flex-1 overflow-y-auto bg-muted/20">{children}</main>
    );
  }

  return <DashboardChrome>{children}</DashboardChrome>;
}

export function LayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <main className="w-full min-h-0 flex-1 overflow-y-auto bg-muted/20">{children}</main>
      }
    >
      <LayoutClientBody>{children}</LayoutClientBody>
    </Suspense>
  );
}
