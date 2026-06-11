import type { ReactNode } from "react";

import { ThreeColumnLayout } from "@/components/platform/ThreeColumnLayout";
import { cn } from "@/lib/utils";

export function WorkspaceLayout({
  toolbar,
  left,
  center,
  right,
  className,
}: {
  toolbar?: ReactNode;
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)} data-layout="workspace">
      {toolbar}
      <ThreeColumnLayout left={left} center={center} right={right} />
    </div>
  );
}
