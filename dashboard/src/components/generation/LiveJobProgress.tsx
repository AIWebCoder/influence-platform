"use client";

import { useEffect, useMemo, useState } from "react";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  formatJobElapsed,
  resolveJobProgressPresentation,
  videoGenerationStartedAt,
  type JobProgressInput,
  type JobProgressLabels,
} from "@/lib/generation-job-progress";

type LiveJobProgressProps = {
  job: JobProgressInput;
  labels: JobProgressLabels;
  locale: string;
  elapsedLabel: string;
  className?: string;
};

export function LiveJobProgress({ job, labels, locale, elapsedLabel, className }: LiveJobProgressProps) {
  const [tick, setTick] = useState(0);
  const presentation = useMemo(
    () => resolveJobProgressPresentation(job, labels, locale),
    [job, labels, locale, tick]
  );
  const startedAt = videoGenerationStartedAt(job);
  const elapsed = formatJobElapsed(startedAt, locale);

  useEffect(() => {
    if (!["running", "pending", "cancelling"].includes(job.status)) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [job.status]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{presentation.phaseLabel}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {elapsed ? (
            <span>
              {elapsedLabel} {elapsed}
            </span>
          ) : null}
          {presentation.showPercent && presentation.percentLabel ? (
            <span className="font-mono tabular-nums">{presentation.percentLabel}</span>
          ) : null}
        </div>
      </div>
      {presentation.barMode === "none" ? null : presentation.barMode === "indeterminate" ? (
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div className="absolute inset-y-0 left-0 w-1/3 animate-[progress-indeterminate_1.4s_ease-in-out_infinite] rounded-full bg-primary" />
        </div>
      ) : (
        <Progress value={presentation.barValue} className="h-2 transition-all duration-500 ease-out" />
      )}
      {presentation.detailLine ? (
        <p className="text-xs text-muted-foreground">{presentation.detailLine}</p>
      ) : null}
      {presentation.etaHint ? (
        <p className="text-[11px] text-muted-foreground/90">{presentation.etaHint}</p>
      ) : null}
    </div>
  );
}
