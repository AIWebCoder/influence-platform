import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface LegalCalloutProps {
  title: string;
  children: ReactNode;
  variant?: "default" | "accent";
  className?: string;
}

export function LegalCallout({
  title,
  children,
  variant = "default",
  className,
}: LegalCalloutProps) {
  return (
    <aside
      className={cn(
        "rounded-xl border p-5 sm:p-6",
        variant === "accent"
          ? "border-primary/20 bg-primary/5"
          : "border-border bg-muted/30",
        className,
      )}
      aria-label={title}
    >
      <h3 className="text-base font-semibold text-foreground sm:text-lg">{title}</h3>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground sm:text-[15px] sm:leading-7">
        {children}
      </div>
    </aside>
  );
}
