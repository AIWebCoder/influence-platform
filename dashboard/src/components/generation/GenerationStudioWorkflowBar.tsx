"use client";

import { Check } from "lucide-react";

import {
  STUDIO_USER_WORKFLOW_PHASES,
  studioUserWorkflowPhaseIndex,
  type StudioUserWorkflowPhase,
} from "@/lib/generation-studio-workflow";
import { cn } from "@/lib/utils";

export type WorkflowStepLabels = {
  configure: string;
  generate: string;
  review: string;
  publish: string;
  configureHint: string;
  generateHint: string;
  reviewHint: string;
  publishHint: string;
};

export function GenerationStudioWorkflowBar({
  phase,
  labels,
  nextHint,
}: {
  phase: StudioUserWorkflowPhase;
  labels: WorkflowStepLabels;
  nextHint?: string | null;
}) {
  const activeIndex = studioUserWorkflowPhaseIndex(phase);

  const stepLabel = (key: StudioUserWorkflowPhase) => labels[key];
  const stepHint = (key: StudioUserWorkflowPhase) => {
    switch (key) {
      case "configure":
        return labels.configureHint;
      case "generate":
        return labels.generateHint;
      case "review":
        return labels.reviewHint;
      case "publish":
        return labels.publishHint;
    }
  };

  return (
    <div className="space-y-2">
      <ol
        className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm"
        aria-label={labels.configure}
      >
        {STUDIO_USER_WORKFLOW_PHASES.map((key, index) => {
          const done = index < activeIndex;
          const current = index === activeIndex;
          return (
            <li key={key} className="flex items-center gap-1">
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
                title={stepHint(key)}
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
                <span>{stepLabel(key)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {nextHint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{nextHint}</p>
      ) : null}
    </div>
  );
}
