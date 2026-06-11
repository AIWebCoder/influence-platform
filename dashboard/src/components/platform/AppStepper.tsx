"use client";

import { Check } from "lucide-react";

import type { AppStepperStep } from "@/lib/platform/stepper";
import { cn } from "@/lib/utils";

export type AppStepperProps = {
  steps: AppStepperStep[];
  nextHint?: string | null;
  "aria-label": string;
};

export function AppStepper({ steps, nextHint, "aria-label": ariaLabel }: AppStepperProps) {
  const hintId = nextHint ? "app-stepper-hint" : undefined;

  return (
    <div className="space-y-2">
      <ol
        className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm"
        aria-label={ariaLabel}
        aria-describedby={hintId}
      >
        {steps.map((step, index) => {
          const done = step.status === "complete";
          const current = step.status === "current";
          return (
            <li key={step.id} className="flex items-center gap-1">
              {index > 0 ? (
                <span className="mx-1 text-muted-foreground/50" aria-hidden>
                  →
                </span>
              ) : null}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  current && "bg-primary/10 text-primary ring-1 ring-primary/25",
                  done && !current && "text-foreground",
                  !done && !current && "text-muted-foreground",
                )}
                aria-current={current ? "step" : undefined}
                title={step.hint}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                    current && "bg-primary text-primary-foreground",
                    done && !current && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                    !done && !current && "bg-muted text-muted-foreground",
                  )}
                >
                  {done && !current ? <Check className="h-3 w-3" aria-hidden /> : index + 1}
                </span>
                <span>{step.label}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {nextHint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {nextHint}
        </p>
      ) : null}
    </div>
  );
}
