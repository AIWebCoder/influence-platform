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
import { Badge } from "@/components/ui/badge";
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
  moreItems: string;
  accounts: string;
};

const MONTH_COMPACT_LIMIT = 2;

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

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status.toLowerCase()) {
    case "published":
      return "secondary";
    case "queued":
      return "default";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
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

function DispatchIntentChip({
  item,
  cal,
  compact,
  onSelect,
}: {
  item: CalendarItem;
  cal: EditorialCalendarCopy;
  compact?: boolean;
  onSelect: (item: CalendarItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "w-full rounded-md border border-border/80 text-left transition-colors hover:bg-muted/60",
        compact ? "px-1.5 py-1 text-[10px]" : "p-2 text-xs",
      )}
    >
      <div className={cn("flex flex-wrap gap-1", compact ? "mb-0.5" : "mb-1")}>
        <Badge variant={statusVariant(item.status)} className="text-[10px]">
          {statusLabel(item.status, cal)}
        </Badge>
        {!compact && item.content_type ? (
          <Badge variant="outline" className="text-[10px]">
            {item.content_type}
          </Badge>
        ) : null}
      </div>
      {!compact ? (
        <p className="line-clamp-2 leading-snug">
          {item.caption || item.niche || item.id.slice(0, 8)}
        </p>
      ) : (
        <p className="truncate tabular-nums text-muted-foreground">
          {item.scheduled_at ? format(new Date(item.scheduled_at), "HH:mm") : "—"}
        </p>
      )}
      {!compact && item.scheduled_at ? (
        <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
          {format(new Date(item.scheduled_at), "HH:mm")}
        </p>
      ) : null}
      {!compact && typeof item.target_count === "number" && item.target_count > 0 ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
          {cal.accounts}: {item.target_count}
        </p>
      ) : null}
    </button>
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

  const scheduledInPeriod = useMemo(
    () => items.filter((i) => i.scheduled_at).length,
    [items],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = format(loadRange.start, "yyyy-MM-dd");
      const end = format(loadRange.end, "yyyy-MM-dd");
      const data = await api.content.getEditorialCalendar({ start_date: start, end_date: end });
      setItems(data);
    } catch (e: unknown) {
      setError(formatContentApiError(e, cal.unavailable));
    } finally {
      setLoading(false);
    }
  }, [loadRange.start, loadRange.end, cal.unavailable]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(
    () => buildByDay(items, visibleDayKeys),
    [items, visibleDayKeys],
  );

  const unscheduled = useMemo(
    () => items.filter((i) => !i.scheduled_at),
    [items],
  );

  const openSchedule = (item: CalendarItem) => {
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

  const handleSaveSchedule = async () => {
    if (!editItem || !editWhen) return;
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
      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        <RefreshCw className={cn("h-4 w-4 sm:mr-1.5", loading && "animate-spin")} />
        <span className="hidden sm:inline">{cal.refresh}</span>
      </Button>
    </div>
  );

  const summaryKey = viewMode === "week" ? "editorialCalendar.weekSummary" : "editorialCalendar.monthSummary";

  return (
    <div className="ops-page-shell">
      <DashboardPageHeader title={cal.title} subtitle={cal.subtitle} actions={periodNav} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p>{cal.hint}</p>
        <p className="tabular-nums">{cal.timezoneNote}</p>
        {!loading && !error ? (
          <p className="tabular-nums">
            {t(summaryKey, {
              scheduled: scheduledInPeriod,
              unscheduled: unscheduled.length,
            })}
          </p>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : viewMode === "week" ? (
        <>
          <div className="grid gap-3 md:grid-cols-7">
            {weekDays.map((day) => {
              const key = dayKey(day);
              const dayItems = byDay[key] || [];
              const isToday = key === dayKey(new Date());
              return (
                <Card
                  key={key}
                  className={cn("min-h-[168px]", isToday && "ring-1 ring-primary/30")}
                >
                  <CardHeader className="space-y-0 pb-2 pt-4">
                    <CardTitle className="flex items-baseline justify-between text-sm font-semibold">
                      <span>{format(day, "EEE", { locale: dateLocale })}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          isToday ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {format(day, "d")}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-4">
                    {dayItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{cal.emptyDay}</p>
                    ) : (
                      dayItems.map((item) => (
                        <DispatchIntentChip
                          key={item.id}
                          item={item}
                          cal={cal}
                          onSelect={openSchedule}
                        />
                      ))
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
      ) : (
        <>
          <div className="hidden grid-cols-7 gap-2 md:grid">
            {Array.from({ length: 7 }, (_, i) => (
              <p
                key={i}
                className="px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), i), "EEE", {
                  locale: dateLocale,
                })}
              </p>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {monthGridDays.map((day) => {
              const key = dayKey(day);
              const dayItems = byDay[key] || [];
              const inMonth = isSameMonth(day, monthAnchor);
              const isToday = key === dayKey(new Date());
              const overflow = dayItems.length - MONTH_COMPACT_LIMIT;
              return (
                <Card
                  key={key}
                  className={cn(
                    "min-h-[108px]",
                    !inMonth && "opacity-45",
                    isToday && "ring-1 ring-primary/30",
                  )}
                >
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-1">
                    <span
                      className={cn(
                        "text-xs font-semibold tabular-nums",
                        isToday ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {dayItems.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-[10px]"
                        onClick={() => openWeekForDay(day)}
                      >
                        {cal.openWeek}
                      </Button>
                    ) : null}
                  </CardHeader>
                  <CardContent className="space-y-1 p-2 pt-0">
                    {dayItems.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground">{cal.emptyDay}</p>
                    ) : (
                      <>
                        {dayItems.slice(0, MONTH_COMPACT_LIMIT).map((item) => (
                          <DispatchIntentChip
                            key={item.id}
                            item={item}
                            cal={cal}
                            compact
                            onSelect={openSchedule}
                          />
                        ))}
                        {overflow > 0 ? (
                          <button
                            type="button"
                            className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() => openWeekForDay(day)}
                          >
                            {t("editorialCalendar.moreItems", { count: overflow })}
                          </button>
                        ) : null}
                      </>
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

      <ScheduleDialog
        cal={cal}
        editItem={editItem}
        editWhen={editWhen}
        saving={saving}
        onClose={() => setEditItem(null)}
        onChangeWhen={setEditWhen}
        onSave={handleSaveSchedule}
        statusLabel={statusLabel}
        statusVariant={statusVariant}
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
  onClose,
  onChangeWhen,
  onSave,
  statusLabel,
  statusVariant,
}: {
  cal: Record<string, string>;
  editItem: CalendarItem | null;
  editWhen: Date | undefined;
  saving: boolean;
  onClose: () => void;
  onChangeWhen: (d: Date | undefined) => void;
  onSave: () => void;
  statusLabel: (status: string, cal: EditorialCalendarCopy) => string;
  statusVariant: (status: string) => "default" | "secondary" | "outline" | "destructive";
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
              <Badge variant={statusVariant(editItem.status)}>
                {statusLabel(editItem.status, cal as EditorialCalendarCopy)}
              </Badge>
            </p>
          ) : null}
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {editItem?.generation_job_id ? (
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
            <Button type="button" onClick={onSave} disabled={saving || !editWhen}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {cal.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
