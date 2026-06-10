import { CalendarDays } from "lucide-react";

import { LEGAL } from "@/lib/legal";
import { cn } from "@/lib/utils";

interface LegalLastUpdatedProps {
  className?: string;
}

export function LegalLastUpdated({ className }: LegalLastUpdatedProps) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground",
        className,
      )}
    >
      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Last updated:{" "}
        <time dateTime={LEGAL.lastUpdatedIso}>{LEGAL.lastUpdated}</time>
      </span>
    </p>
  );
}
