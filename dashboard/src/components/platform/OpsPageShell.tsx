import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function OpsPageShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex-1 w-full min-w-0 space-y-6 p-8 pt-6", className)}>{children}</div>
  );
}
