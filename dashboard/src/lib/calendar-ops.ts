import { format } from "date-fns";
import type { Locale } from "date-fns";

export type CalendarOpsItem = {
  id: string;
  caption?: string | null;
  scheduled_at?: string | null;
  niche?: string | null;
  status: string;
  content_type?: string;
  target_count?: number;
};

export type StatusTier = "action" | "pipeline" | "terminal";

export function statusTier(status: string): StatusTier {
  switch (status.toLowerCase()) {
    case "draft":
    case "failed":
      return "action";
    case "published":
      return "terminal";
    default:
      return "pipeline";
  }
}

export function sumDispatchTargets(items: CalendarOpsItem[]): number {
  return items.reduce((sum, item) => sum + (item.target_count ?? 0), 0);
}

export function chipBorderClass(status: string): string {
  switch (status.toLowerCase()) {
    case "failed":
      return "border-destructive/35";
    case "draft":
      return "border-dashed border-foreground/15";
    default:
      return "border-border/80";
  }
}

export type PeriodOpsMetrics = {
  scheduledIntents: CalendarOpsItem[];
  intentCount: number;
  targetCount: number;
  awaitingSlot: number;
  peakDay: { key: string; label: string; intentCount: number; targetCount: number } | null;
  nextDispatch: { at: Date; timeLabel: string; caption: string } | null;
};

export function computePeriodOpsMetrics(
  items: CalendarOpsItem[],
  dayKeys: string[],
  dayLabels: Record<string, string>,
  now = new Date(),
): PeriodOpsMetrics {
  const scheduledIntents = items.filter((i) => i.scheduled_at);
  const awaitingSlot = items.filter((i) => !i.scheduled_at).length;

  let peakDay: PeriodOpsMetrics["peakDay"] = null;
  for (const key of dayKeys) {
    const dayItems = scheduledIntents.filter(
      (i) => i.scheduled_at && format(new Date(i.scheduled_at), "yyyy-MM-dd") === key,
    );
    if (dayItems.length === 0) continue;
    if (!peakDay || dayItems.length > peakDay.intentCount) {
      peakDay = {
        key,
        label: dayLabels[key] ?? key,
        intentCount: dayItems.length,
        targetCount: sumDispatchTargets(dayItems),
      };
    }
  }

  const upcoming = scheduledIntents
    .map((i) => ({ item: i, at: new Date(i.scheduled_at!) }))
    .filter(({ at }) => at.getTime() >= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const next = upcoming[0];
  const nextDispatch = next
    ? {
        at: next.at,
        timeLabel: format(next.at, "EEE d MMM · HH:mm"),
        caption: next.item.caption?.slice(0, 48) || next.item.niche || next.item.id.slice(0, 8),
      }
    : null;

  return {
    scheduledIntents,
    intentCount: scheduledIntents.length,
    targetCount: sumDispatchTargets(scheduledIntents),
    awaitingSlot,
    peakDay,
    nextDispatch,
  };
}

export function buildDayLabels(days: Date[], dateLocale: Locale): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const day of days) {
    labels[format(day, "yyyy-MM-dd")] = format(day, "EEE d", { locale: dateLocale });
  }
  return labels;
}

/** Tertiary meta line: content type, niche, targets (status is shown separately). */
export function buildChipMetaParts(item: CalendarOpsItem, targetsLabel: string | null): string {
  return [item.content_type, item.niche, targetsLabel]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}