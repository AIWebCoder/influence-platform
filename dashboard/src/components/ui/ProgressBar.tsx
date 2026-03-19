"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  showLabel?: boolean;
}

function getProgressColor(value: number): string {
  if (value >= 80) return "bg-[#639922]";
  if (value >= 50) return "bg-[#BA7517]";
  return "bg-[#E24B4A]";
}

export function ProgressBar({ value, max = 100, className, showLabel = false }: ProgressBarProps) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));
  const colorClass = getProgressColor(percentage);

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "h-[var(--bar-height)] rounded-full overflow-hidden",
          "bg-zinc-200 dark:bg-zinc-700/50"
        )}
      >
        <div
          className={cn("h-full transition-all duration-300", colorClass)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground mt-1">{Math.round(percentage)}%</span>
      )}
    </div>
  );
}