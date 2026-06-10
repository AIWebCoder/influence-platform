"use client";

import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkflowStepDef = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
};

export function EngagementWorkflowBar({ steps }: { steps: WorkflowStepDef[] }) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 shadow-sm sm:gap-0">
      {steps.map((step, index) => (
        <div key={step.id} className="flex min-w-0 flex-1 items-center">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                step.done
                  ? "border-primary bg-primary text-primary-foreground"
                  : step.active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-muted-foreground/25 bg-muted/30 text-muted-foreground",
              )}
            >
              {step.done ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <span>{index + 1}</span>
              )}
            </span>
            <span
              className={cn(
                "truncate text-sm",
                step.done || step.active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 ? (
            <div
              className={cn(
                "mx-3 hidden h-0.5 min-w-[1.5rem] flex-1 rounded-full sm:block",
                step.done ? "bg-primary/40" : "bg-border",
              )}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
