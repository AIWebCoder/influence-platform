"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function KpiCard({
  title,
  value,
  icon: Icon,
  accent,
}: {
  title: string;
  value: number | string;
  icon: LucideIcon;
  accent: "blue" | "violet" | "amber" | "emerald";
}) {
  const accentClass = {
    blue: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    violet: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  }[accent];

  return (
    <div className="rounded-xl border bg-card px-4 py-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", accentClass)}>
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}

export type EngagementKpiItem = {
  title: string;
  value: number | string;
  icon: LucideIcon;
  accent: "blue" | "violet" | "amber" | "emerald";
};

export function EngagementKpiStrip({ items }: { items: EngagementKpiItem[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {items.map((item) => (
        <KpiCard key={item.title} {...item} />
      ))}
    </div>
  );
}
