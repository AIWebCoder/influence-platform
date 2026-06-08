"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { enUS, fr as frLocale } from "date-fns/locale";
import toast from "react-hot-toast";

import { api, formatContentApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  buildCalendarPreviewItems,
  calendarPreviewEnabledByEnv,
  isCalendarPreviewItem,
} from "@/lib/calendar-preview-data";
import {
  buildChipMetaParts,
  buildDayLabels,
  chipBorderClass,
  computePeriodOpsMetrics,
  statusTier,
  sumDispatchTargets,
} from "@/lib/calendar-ops";

type CalendarItem = {
  id: string;
  generation_job_id?: string | null;
  caption?: string | null;
  visual_url?: string | null;
  scheduled_at?: string | null;
  niche?: string | null;
  status: string;
  mode?: string;
  content_type?: string;
  target_count?: number;
};

type ViewMode = "week" | "month";

type EditorialCalendarCopy = {
  statusDraft: string;
  statusReady: string;
  statusQueued: string;
  statusPublished: string;
  statusFailed: string;
  emptyDay: string;
  emptyDayTodayNext: string;
  moreItems: string;
  chipTargets: string;
  statusLegend: string;
  kpiScheduledIntents: string;
  kpiDispatchTargets: string;
  kpiAwaitingSlot: string;
  kpiPeakDay: string;
  kpiNextDispatch: string;
  kpiNextDispatchNone: string;
  kpiThroughputSub: string;
  dayDrawerSummary: string;
};

/** Typical ops load: show every dispatch inline up to this count; drawer only above. */
const WEEK_DAY_SOFT_LIMIT = 5;
const MONTH_COMPACT_LIMIT = 2;
const WEEK_DAY_MIN_HEIGHT = "min-h-[168px]";
const MONTH_DAY_HEIGHT = "h-[140px]";
const CALENDAR_GRID_GAP = "gap-3.5";
const DAY_HEADER_HEIGHT = "h-10";
const DAY_INSET_X = "px-3.5";
const DAY_CONTENT_PAD = "px-3.5 pb-3.5 pt-2.5";

function statusLabel(status: string, cal: EditorialCalendarCopy): string {
  switch (status.toLowerCase()) {
    case "draft":
      return cal.statusDraft;
    case "ready":
      return cal.statusReady;
    case "queued":
      return cal.statusQueued;
    case "published":
      return cal.statusPublished;
    case "failed":
      return cal.statusFailed;
    default:
      return status;
  }
}

function StatusText({
  status,
  cal,
  className,
}: {
  status: string;
  cal: EditorialCalendarCopy;
  className?: string;
}) {
  const tier = statusTier(status);
  const normalized = status.toLowerCase();
  return (
    <span
      className={cn(
        tier === "action" && normalized === "failed" && "text-destructive",
        tier === "action" && normalized !== "failed" && "text-foreground",
        tier !== "action" && "text-muted-foreground",
        className,
      )}
    >
      {statusLabel(status, cal)}
    </span>
  );
}

function dayKey(day: Date) {
  return format(day, "yyyy-MM-dd");
}

function buildByDay(items: CalendarItem[], dayKeys: string[]) {
  const map: Record<string, CalendarItem[]> = {};
  for (const key of dayKeys) {
    map[key] = [];
  }
  for (const item of items) {
    if (!item.scheduled_at) continue;
    const key = dayKey(new Date(item.scheduled_at));
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  for (const key of Object.keys(map)) {
    map[key].sort(
      (a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
    );
  }
  return map;
}

function weekDayDisplaySlice(dayItems: CalendarItem[]) {
  if (dayItems.length <= WEEK_DAY_SOFT_LIMIT) {
    return { visible: dayItems, overflow: 0 };
  }
  return {
    visible: dayItems.slice(0, WEEK_DAY_SOFT_LIMIT),
    overflow: dayItems.length - WEEK_DAY_SOFT_LIMIT,
  };
}

function DayDispatchCountBadge({
  intentCount,
  label,
}: {
  intentCount: number;
  targetCount: number;
  label: string;
}) {
  if (intentCount <= 0) return null;
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border/80 bg-muted/30 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
      aria-label={label}
      title={label}
    >
      {intentCount}
    </span>
  );
}

function DispatchOpsKpiStrip({
  cal,
  metrics,
  throughputSub,
  peakDayValue,
  nextDispatchLine,
  nextDispatchSub,
}: {
  cal: EditorialCalendarCopy;
  metrics: ReturnType<typeof computePeriodOpsMetrics>;
  throughputSub: string;
  peakDayValue: string;
  nextDispatchLine: string;
  nextDispatchSub?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-5 md:items-stretch">
      <OpsKpiCell label={cal.kpiScheduledIntents} value={String(metrics.intentCount)} sub={throughputSub} />
      <OpsKpiCell label={cal.kpiDispatchTargets} value={String(metrics.targetCount)} />
      <OpsKpiCell
        label={cal.kpiAwaitingSlot}
        value={String(metrics.awaitingSlot)}
        emphasize={metrics.awaitingSlot > 0}
      />
      <OpsKpiCell label={cal.kpiPeakDay} value={peakDayValue} />
      <OpsKpiCell
        label={cal.kpiNextDispatch}
        value={nextDispatchLine}
        sub={nextDispatchSub}
        compactValue
      />
    </div>
  );
}

function OpsKpiCell({
  label,
  value,
  sub,
  emphasize,
  compactValue,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasize?: boolean;
  compactValue?: boolean;
}) {
  return (
    <div className="flex h-full min-h-[88px] flex-col rounded-lg border border-border/80 bg-card px-4 py-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-semibold tabular-nums tracking-tight",
          compactValue ? "text-sm leading-snug" : "text-xl",
          emphasize && "text-foreground",
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-auto pt-1.5 text-[10px] leading-snug text-muted-foreground tabular-nums">{sub}</p>
      ) : (
        <span className="mt-auto" aria-hidden />
      )}
    </div>
  );
}

function WeekDayHeader({
  weekday,
  dayNumber,
  intentCount,
  targetCount,
  countLabel,
  isToday,
}: {
  weekday: string;
  dayNumber: string;
  intentCount: number;
  targetCount: number;
  countLabel: string;
  isToday: boolean;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between border-b border-border/40",
        DAY_HEADER_HEIGHT,
        DAY_INSET_X,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/90">
          {weekday}
        </span>
        <DayDispatchCountBadge
          intentCount={intentCount}
          targetCount={targetCount}
          label={countLabel}
        />
      </div>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums leading-none",
          isToday ? "text-primary" : "text-muted-foreground",
        )}
      >
        {dayNumber}
      </span>
    </div>
  );
}

function MonthDayHeader({
  dayNumber,
  intentCount,
  targetCount,
  countLabel,
  isToday,
  showOpenWeek,
  openWeekLabel,
  onOpenWeek,
}: {
  dayNumber: string;
  intentCount: number;
  targetCount: number;
  countLabel: string;
  isToday: boolean;
  showOpenWeek: boolean;
  openWeekLabel: string;
  onOpenWeek: () => void;
}) {
  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-[1fr_auto] items-center border-b border-border/40",
        DAY_HEADER_HEIGHT,
        DAY_INSET_X,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "text-xs font-semibold tabular-nums leading-none",
            isToday ? "text-primary" : "text-muted-foreground",
          )}
        >
          {dayNumber}
        </span>
        <DayDispatchCountBadge
          intentCount={intentCount}
          targetCount={targetCount}
          label={countLabel}
        />
      </div>
      <div className="flex h-7 w-[4.5rem] items-center justify-end">
        {showOpenWeek ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[10px]"
            onClick={onOpenWeek}
          >
            {openWeekLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function EmptyDaySlot({
  cal,
  isToday,
  nextWhen,
  compact,
}: {
  cal: EditorialCalendarCopy;
  isToday: boolean;
  nextWhen?: string;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-2 py-4 text-center">
      <p
        className={cn(
          "text-muted-foreground/50",
          compact ? "text-[10px]" : "text-[11px]",
        )}
      >
        {cal.emptyDay}
      </p>
      {isToday && nextWhen ? (
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground/70">{nextWhen}</p>
      ) : null}
    </div>
  );
}

function DayColumnFooter({
  overflow,
  moreLabel,
  onShowMore,
}: {
  overflow: number;
  moreLabel: string;
  onShowMore?: () => void;
}) {
  if (overflow <= 0 || !onShowMore) return null;

  return (
    <div className="mt-3 shrink-0 border-t border-border/30 pt-2.5">
      <button
        type="button"
        onClick={onShowMore}
        className="w-full text-left text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {moreLabel}
      </button>
    </div>
  );
}

function DispatchIntentChip({
  item,
  cal,
  variant = "week",
  onSelect,
}: {
  item: CalendarItem;
  cal: EditorialCalendarCopy;
  variant?: "week" | "compact" | "drawer";
  onSelect: (item: CalendarItem) => void;
}) {
  const { t } = useLocale();
  const timeLabel = item.scheduled_at ? format(new Date(item.scheduled_at), "HH:mm") : "—";
  const caption = item.caption || item.niche || item.id.slice(0, 8);
  const targetsLabel =
    typeof item.target_count === "number" && item.target_count > 0
      ? t("editorialCalendar.chipTargets", { count: item.target_count })
      : null;
  const metaLine = buildChipMetaParts(item, targetsLabel);

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={() => onSelect(item)}
        className={cn(
          "w-full rounded-md border text-left transition-colors hover:bg-muted/60",
          chipBorderClass(item.status),
          "px-2 py-2",
        )}
      >
        <p className="text-[10px] font-semibold tabular-nums">{timeLabel}</p>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{caption}</p>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "w-full rounded-md border text-left transition-colors hover:bg-muted/60",
        chipBorderClass(item.status),
        variant === "drawer" ? "p-3.5" : "p-2.5",
      )}
    >
      <p className="text-sm font-semibold tabular-nums tracking-tight">{timeLabel}</p>
      <p className="mt-1 line-clamp-2 text-xs leading-snug text-foreground/85">{caption}</p>
      {metaLine ? (
        <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">{metaLine}</p>
      ) : null}
      <p className="mt-1.5 text-[10px]">
        <StatusText status={item.status} cal={cal} />
      </p>
    </button>
  );
}

function DayDetailDrawer({
  open,
  day,
  items,
  cal,
  dateLocale,
  onClose,
  onSelectItem,
  summaryLabel,
}: {
  open: boolean;
  day: Date | null;
  items: CalendarItem[];
  cal: EditorialCalendarCopy;
  dateLocale: typeof enUS;
  onClose: () => void;
  onSelectItem: (item: CalendarItem) => void;
  summaryLabel: string;
}) {
  if (!day) return null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b border-border/40 px-5 py-4 text-left">
          <SheetTitle className="text-base font-semibold leading-snug">
            {format(day, "EEEE d MMMM", { locale: dateLocale })}
          </SheetTitle>
          <SheetDescription className="text-xs tabular-nums">{summaryLabel}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{cal.emptyDay}</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <DispatchIntentChip
                  key={item.id}
                  item={item}
                  cal={cal}
                  variant="drawer"
                  onSelect={onSelectItem}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function CalendarPage() {
  const { locale, text, t } = useLocale();
  const cal = text.editorialCalendar;
  const dateLocale = locale === "fr" ? frLocale : enUS;

  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editItem, setEditItem] = useState<CalendarItem | null>(null);
  const [editWhen, setEditWhen] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [nicheFilter, setNicheFilter] = useState<string>("all");
  const [nicheOptions, setNicheOptions] = useState<string[]>([]);
  const [previewEnabled, setPreviewEnabled] = useState(calendarPreviewEnabledByEnv);
  const [dayDrawerDay, setDayDrawerDay] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.content.getNiches();
        if (cancelled) return;
        const names = (rows as Array<{ name?: string }>)
          .map((r) => r.name?.trim())
          .filter((n): n is string => Boolean(n));
        setNicheOptions(Array.from(new Set(names)).sort());
      } catch {
        if (!cancelled) setNicheOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)),
    [weekAnchor],
  );

  const monthGridDays = useMemo(() => {
    const monthStart = startOfMonth(monthAnchor);
    const monthEnd = endOfMonth(monthAnchor);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [monthAnchor]);

  const loadRange = useMemo(() => {
    if (viewMode === "week") {
      return { start: weekAnchor, end: addDays(weekAnchor, 6) };
    }
    return { start: monthGridDays[0], end: monthGridDays[monthGridDays.length - 1] };
  }, [viewMode, weekAnchor, monthGridDays]);

  const periodLabel = useMemo(() => {
    if (viewMode === "week") {
      const end = addDays(weekAnchor, 6);
      return `${format(weekAnchor, "d MMM", { locale: dateLocale })} – ${format(end, "d MMM yyyy", { locale: dateLocale })}`;
    }
    return format(monthAnchor, "MMMM yyyy", { locale: dateLocale });
  }, [viewMode, weekAnchor, monthAnchor, dateLocale]);

  const visibleDayKeys = useMemo(
    () => (viewMode === "week" ? weekDays.map(dayKey) : monthGridDays.map(dayKey)),
    [viewMode, weekDays, monthGridDays],
  );

  const previewItems = useMemo(
    () =>
      buildCalendarPreviewItems(
        viewMode === "week" ? weekAnchor : monthAnchor,
        viewMode,
        nicheFilter,
      ),
    [viewMode, weekAnchor, monthAnchor, nicheFilter],
  );

  const displayItems = previewEnabled ? previewItems : items;

  const opsDayKeys = useMemo(
    () =>
      viewMode === "week"
        ? weekDays.map(dayKey)
        : monthGridDays
            .filter((d) => isSameMonth(d, monthAnchor))
            .map(dayKey),
    [viewMode, weekDays, monthGridDays, monthAnchor],
  );

  const opsDayLabels = useMemo(
    () =>
      buildDayLabels(
        viewMode === "week" ? weekDays : monthGridDays.filter((d) => isSameMonth(d, monthAnchor)),
        dateLocale,
      ),
    [viewMode, weekDays, monthGridDays, monthAnchor, dateLocale],
  );

  const opsMetrics = useMemo(
    () => computePeriodOpsMetrics(displayItems, opsDayKeys, opsDayLabels),
    [displayItems, opsDayKeys, opsDayLabels],
  );

  const throughputSub = t("editorialCalendar.kpiThroughputSub", {
    intents: opsMetrics.intentCount,
    targets: opsMetrics.targetCount,
  });

  const peakDayValue = opsMetrics.peakDay
    ? t("editorialCalendar.kpiPeakDayValue", {
        day: opsMetrics.peakDay.label,
        intents: opsMetrics.peakDay.intentCount,
      })
    : "—";

  const nextDispatchLine = opsMetrics.nextDispatch
    ? opsMetrics.nextDispatch.timeLabel
    : cal.kpiNextDispatchNone;

  const todayNextWhen = opsMetrics.nextDispatch
    ? t("editorialCalendar.emptyDayTodayNext", {
        when: format(opsMetrics.nextDispatch.at, "EEE HH:mm", { locale: dateLocale }),
      })
    : undefined;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = format(loadRange.start, "yyyy-MM-dd");
      const end = format(loadRange.end, "yyyy-MM-dd");
      const data = await api.content.getEditorialCalendar({
        start_date: start,
        end_date: end,
        ...(nicheFilter !== "all" ? { niche: nicheFilter } : {}),
      });
      setItems(data);
    } catch (e: unknown) {
      setError(formatContentApiError(e, cal.unavailable));
    } finally {
      setLoading(false);
    }
  }, [loadRange.start, loadRange.end, nicheFilter, cal.unavailable]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(
    () => buildByDay(displayItems, visibleDayKeys),
    [displayItems, visibleDayKeys],
  );

  const unscheduled = useMemo(
    () => displayItems.filter((i) => !i.scheduled_at),
    [displayItems],
  );

  const showEmptyHint =
    !loading && !error && !previewEnabled && items.length === 0;

  const openSchedule = (item: CalendarItem) => {
    if (isCalendarPreviewItem(item.id)) {
      if (item.status === "queued" || item.status === "published") {
        toast.error(cal.previewQueuedBlocked);
        return;
      }
      setEditItem(item);
      setEditWhen(item.scheduled_at ? new Date(item.scheduled_at) : new Date());
      return;
    }
    if (item.status === "queued" || item.status === "published") {
      toast.error(cal.cannotReschedule);
      return;
    }
    setEditItem(item);
    setEditWhen(item.scheduled_at ? new Date(item.scheduled_at) : new Date());
  };

  const openWeekForDay = (day: Date) => {
    setWeekAnchor(startOfWeek(day, { weekStartsOn: 1 }));
    setViewMode("week");
  };

  const openDayDrawer = (day: Date) => {
    setDayDrawerDay(day);
  };

  const dayDrawerItems = useMemo(() => {
    if (!dayDrawerDay) return [];
    return byDay[dayKey(dayDrawerDay)] || [];
  }, [dayDrawerDay, byDay]);

  const dayDrawerSummary = dayDrawerDay
    ? t("editorialCalendar.dayDrawerSummary", {
        intents: dayDrawerItems.length,
        targets: sumDispatchTargets(dayDrawerItems),
      })
    : "";

  const handleSaveSchedule = async () => {
    if (!editItem || !editWhen) return;
    if (isCalendarPreviewItem(editItem.id)) {
      toast.error(cal.previewScheduleBlocked);
      return;
    }
    setSaving(true);
    try {
      await api.content.patchPublishIntentSchedule(editItem.id, editWhen.toISOString());
      toast.success(cal.scheduleSaved);
      setEditItem(null);
      await load();
    } catch (e: unknown) {
      toast.error(formatContentApiError(e, cal.scheduleError));
    } finally {
      setSaving(false);
    }
  };

  const goPrev = () => {
    if (viewMode === "week") setWeekAnchor((w) => subWeeks(w, 1));
    else setMonthAnchor((m) => subMonths(m, 1));
  };

  const goNext = () => {
    if (viewMode === "week") setWeekAnchor((w) => addWeeks(w, 1));
    else setMonthAnchor((m) => addMonths(m, 1));
  };

  const goToday = () => {
    if (viewMode === "week") setWeekAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }));
    else setMonthAnchor(startOfMonth(new Date()));
  };

  const periodNav = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-md border border-border p-0.5">
        <Button
          type="button"
          variant={viewMode === "week" ? "secondary" : "ghost"}
          size="sm"
          className="h-8 px-2.5"
          onClick={() => setViewMode("week")}
        >
          {cal.viewWeek}
        </Button>
        <Button
          type="button"
          variant={viewMode === "month" ? "secondary" : "ghost"}
          size="sm"
          className="h-8 px-2.5"
          onClick={() => setViewMode("month")}
        >
          {cal.viewMonth}
        </Button>
      </div>
      <span className="hidden text-xs font-medium tabular-nums text-muted-foreground sm:inline">
        {periodLabel}
      </span>
      <Button variant="outline" size="icon" onClick={goPrev}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={goToday}>
        {viewMode === "week" ? cal.thisWeek : cal.thisMonth}
      </Button>
      <Button variant="outline" size="icon" onClick={goNext}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={load} disabled={loading || previewEnabled}>
        <RefreshCw className={cn("h-4 w-4 sm:mr-1.5", loading && "animate-spin")} />
        <span className="hidden sm:inline">{cal.refresh}</span>
      </Button>
      <Button
        variant={previewEnabled ? "secondary" : "outline"}
        size="sm"
        onClick={() => setPreviewEnabled((on) => !on)}
      >
        {previewEnabled ? cal.previewDisable : cal.previewEnable}
      </Button>
    </div>
  );

  return (
    <div className="ops-page-shell">
      <DashboardPageHeader title={cal.title} subtitle={cal.subtitle} actions={periodNav} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs text-muted-foreground">{cal.hint}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">{cal.timezoneNote}</p>
          <p className="text-[10px] text-muted-foreground">{cal.statusLegend}</p>
        </div>
        {nicheOptions.length > 0 ? (
          <div className="w-full sm:w-[200px]">
            <Label className="text-xs text-muted-foreground">{cal.filterNiche}</Label>
            <Select value={nicheFilter} onValueChange={setNicheFilter}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue placeholder={cal.filterAllNiches} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{cal.filterAllNiches}</SelectItem>
                {nicheOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {!loading && !error ? (
        <DispatchOpsKpiStrip
          cal={cal}
          metrics={opsMetrics}
          throughputSub={throughputSub}
          peakDayValue={peakDayValue}
          nextDispatchLine={nextDispatchLine}
          nextDispatchSub={opsMetrics.nextDispatch?.caption}
        />
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {previewEnabled ? (
        <Alert>
          <AlertDescription>{cal.previewBanner}</AlertDescription>
        </Alert>
      ) : null}

      {showEmptyHint ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{cal.previewEmptyHint}</span>
            <Button type="button" size="sm" variant="secondary" onClick={() => setPreviewEnabled(true)}>
              {cal.previewEnable}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "week" ? (
        <>
          <div className="overflow-x-auto pb-1 md:overflow-visible">
            <div className={cn("grid min-w-[960px] grid-cols-7 items-stretch md:min-w-0", CALENDAR_GRID_GAP)}>
              {weekDays.map((day) => {
                const key = dayKey(day);
                const dayItems = byDay[key] || [];
                const { visible: visibleItems, overflow } = weekDayDisplaySlice(dayItems);
                const isToday = key === dayKey(new Date());
                const dayTargets = sumDispatchTargets(dayItems);
                const countLabel = t("editorialCalendar.dayDispatchTooltip", {
                  intents: dayItems.length,
                  targets: dayTargets,
                });
                return (
                  <Card
                    key={key}
                    className={cn(
                      "flex h-full flex-col",
                      WEEK_DAY_MIN_HEIGHT,
                      dayItems.length === 0 && "border-dashed border-border/50",
                      isToday && "ring-1 ring-primary/30",
                    )}
                  >
                    <WeekDayHeader
                      weekday={format(day, "EEE", { locale: dateLocale })}
                      dayNumber={format(day, "d")}
                      intentCount={dayItems.length}
                      targetCount={dayTargets}
                      countLabel={countLabel}
                      isToday={isToday}
                    />
                    <CardContent className={cn("flex flex-1 flex-col p-0", DAY_CONTENT_PAD)}>
                      {dayItems.length === 0 ? (
                        <EmptyDaySlot
                          cal={cal}
                          isToday={isToday}
                          nextWhen={isToday ? todayNextWhen : undefined}
                        />
                      ) : (
                        <div className="space-y-2">
                          {visibleItems.map((item) => (
                            <DispatchIntentChip
                              key={item.id}
                              item={item}
                              cal={cal}
                              onSelect={openSchedule}
                            />
                          ))}
                        </div>
                      )}
                      <DayColumnFooter
                        overflow={overflow}
                        moreLabel={t("editorialCalendar.moreItems", { count: overflow })}
                        onShowMore={() => openDayDrawer(day)}
                      />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
          {unscheduled.length > 0 ? (
            <UnscheduledPanel
              cal={cal}
              items={unscheduled}
              onSelect={openSchedule}
            />
          ) : null}
        </>
      ) : (
        <>
          <div className={cn("mb-3 hidden grid-cols-7 md:grid", CALENDAR_GRID_GAP)}>
            {Array.from({ length: 7 }, (_, i) => (
              <p
                key={i}
                className={cn(
                  "text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
                  DAY_INSET_X,
                )}
              >
                {format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i), "EEE", {
                  locale: dateLocale,
                })}
              </p>
            ))}
          </div>
          <div className={cn("grid grid-cols-7", CALENDAR_GRID_GAP)}>
            {monthGridDays.map((day) => {
              const key = dayKey(day);
              const dayItems = byDay[key] || [];
              const inMonth = isSameMonth(day, monthAnchor);
              const isToday = key === dayKey(new Date());
              const overflow = dayItems.length - MONTH_COMPACT_LIMIT;
              const dayTargets = sumDispatchTargets(dayItems);
              const countLabel = t("editorialCalendar.dayDispatchTooltip", {
                intents: dayItems.length,
                targets: dayTargets,
              });
              return (
                <Card
                  key={key}
                  className={cn(
                    "flex flex-col overflow-hidden",
                    MONTH_DAY_HEIGHT,
                    !inMonth && "opacity-45",
                    dayItems.length === 0 && inMonth && "border-dashed border-border/60",
                    isToday && "ring-1 ring-primary/30",
                  )}
                >
                  {inMonth ? (
                    <MonthDayHeader
                      dayNumber={format(day, "d")}
                      intentCount={dayItems.length}
                      targetCount={dayTargets}
                      countLabel={countLabel}
                      isToday={isToday}
                      showOpenWeek={dayItems.length > 0}
                      openWeekLabel={cal.openWeek}
                      onOpenWeek={() => openWeekForDay(day)}
                    />
                  ) : (
                    <div className={cn("shrink-0 border-b border-transparent", DAY_HEADER_HEIGHT, DAY_INSET_X)} />
                  )}
                  <CardContent
                    className={cn(
                      "flex min-h-0 flex-1 flex-col p-0",
                      inMonth ? "px-3 pb-3 pt-2" : "p-0",
                    )}
                  >
                    {dayItems.length === 0 ? (
                      inMonth ? (
                        <EmptyDaySlot
                          cal={cal}
                          isToday={isToday}
                          nextWhen={isToday ? todayNextWhen : undefined}
                          compact
                        />
                      ) : null
                    ) : (
                      <div className="flex min-h-0 flex-1 flex-col space-y-1.5">
                        {dayItems.slice(0, MONTH_COMPACT_LIMIT).map((item) => (
                          <DispatchIntentChip
                            key={item.id}
                            item={item}
                            cal={cal}
                            variant="compact"
                            onSelect={openSchedule}
                          />
                        ))}
                        {overflow > 0 ? (
                          <button
                            type="button"
                            className="mt-auto w-full pt-1 text-left text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => openDayDrawer(day)}
                          >
                            {t("editorialCalendar.moreItems", { count: overflow })}
                          </button>
                        ) : (
                          <span className="mt-auto" aria-hidden />
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {unscheduled.length > 0 ? (
            <UnscheduledPanel
              cal={cal}
              items={unscheduled}
              onSelect={openSchedule}
            />
          ) : null}
        </>
      )}

      <DayDetailDrawer
        open={Boolean(dayDrawerDay)}
        day={dayDrawerDay}
        items={dayDrawerItems}
        cal={cal}
        dateLocale={dateLocale}
        onClose={() => setDayDrawerDay(null)}
        onSelectItem={(item) => {
          setDayDrawerDay(null);
          openSchedule(item);
        }}
        summaryLabel={dayDrawerSummary}
      />

      <ScheduleDialog
        cal={cal}
        editItem={editItem}
        editWhen={editWhen}
        saving={saving}
        previewMode={Boolean(editItem && isCalendarPreviewItem(editItem.id))}
        onClose={() => setEditItem(null)}
        onChangeWhen={setEditWhen}
        onSave={handleSaveSchedule}
      />
    </div>
  );
}

function UnscheduledPanel({
  cal,
  items,
  onSelect,
}: {
  cal: { unscheduled: string; unscheduledHint: string };
  items: CalendarItem[];
  onSelect: (item: CalendarItem) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
          {cal.unscheduled} ({items.length})
        </CardTitle>
        <p className="page-subtitle text-muted-foreground !mt-1">{cal.unscheduledHint}</p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 pt-0">
        {items.map((item) => (
          <Button key={item.id} variant="outline" size="sm" onClick={() => onSelect(item)}>
            {item.caption?.slice(0, 40) || item.niche || item.id.slice(0, 8)}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

function ScheduleDialog({
  cal,
  editItem,
  editWhen,
  saving,
  previewMode,
  onClose,
  onChangeWhen,
  onSave,
}: {
  cal: Record<string, string>;
  editItem: CalendarItem | null;
  editWhen: Date | undefined;
  saving: boolean;
  previewMode?: boolean;
  onClose: () => void;
  onChangeWhen: (d: Date | undefined) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={Boolean(editItem)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{cal.scheduleDialogTitle}</DialogTitle>
          <DialogDescription>
            {editItem?.caption?.slice(0, 120) || editItem?.niche || editItem?.id}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{cal.dateTime}</Label>
            <DateTimePicker
              value={editWhen}
              onChange={onChangeWhen}
              placeholder={cal.pickSlot}
            />
            <p className="text-xs text-muted-foreground">{cal.timezoneNote}</p>
          </div>
          {editItem ? (
            <p className="text-xs text-muted-foreground">
              {cal.status}:{" "}
              <StatusText status={editItem.status} cal={cal as EditorialCalendarCopy} />
            </p>
          ) : null}
          {previewMode ? (
            <p className="text-xs text-muted-foreground">{cal.previewScheduleBlocked}</p>
          ) : null}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {editItem?.generation_job_id && !previewMode ? (
            <Button type="button" variant="outline" asChild>
              <Link
                href={`/generation-studio?job=${encodeURIComponent(editItem.generation_job_id)}`}
              >
                <ExternalLink className="mr-1 h-3.5 w-3.5" />
                {cal.openStudio}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {cal.cancel}
            </Button>
            <Button type="button" onClick={onSave} disabled={saving || !editWhen || previewMode}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {cal.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
