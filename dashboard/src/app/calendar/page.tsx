"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
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

type EditorialCalendarCopy = {
  statusDraft: string;
  statusReady: string;
  statusQueued: string;
  statusPublished: string;
  statusFailed: string;
};

function statusLabel(
  status: string,
  cal: EditorialCalendarCopy,
): string {
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

export default function CalendarPage() {
  const { locale, text, t } = useLocale();
  const cal = text.editorialCalendar;
  const dateLocale = locale === "fr" ? frLocale : enUS;

  const [weekAnchor, setWeekAnchor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editItem, setEditItem] = useState<CalendarItem | null>(null);
  const [editWhen, setEditWhen] = useState<Date | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekAnchor, i)),
    [weekAnchor],
  );

  const weekRangeLabel = useMemo(() => {
    const end = addDays(weekAnchor, 6);
    return `${format(weekAnchor, "d MMM", { locale: dateLocale })} – ${format(end, "d MMM yyyy", { locale: dateLocale })}`;
  }, [weekAnchor, dateLocale]);

  const scheduledThisWeek = useMemo(
    () => items.filter((i) => i.scheduled_at).length,
    [items],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const start = format(weekAnchor, "yyyy-MM-dd");
      const end = format(addDays(weekAnchor, 6), "yyyy-MM-dd");
      const data = await api.content.getEditorialCalendar({ start_date: start, end_date: end });
      setItems(data);
    } catch (e: unknown) {
      setError(formatContentApiError(e, cal.unavailable));
    } finally {
      setLoading(false);
    }
  }, [weekAnchor, cal.unavailable]);

  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarItem[]> = {};
    for (const d of days) {
      map[format(d, "yyyy-MM-dd")] = [];
    }
    for (const item of items) {
      if (!item.scheduled_at) continue;
      const key = format(new Date(item.scheduled_at), "yyyy-MM-dd");
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    for (const key of Object.keys(map)) {
      map[key].sort(
        (a, b) =>
          new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime(),
      );
    }
    return map;
  }, [items, days]);

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

  const weekNav = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="hidden text-xs font-medium tabular-nums text-muted-foreground sm:inline">
        {weekRangeLabel}
      </span>
      <Button variant="outline" size="icon" onClick={() => setWeekAnchor((w) => subWeeks(w, 1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setWeekAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}
      >
        {cal.thisWeek}
      </Button>
      <Button variant="outline" size="icon" onClick={() => setWeekAnchor((w) => addWeeks(w, 1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" onClick={load} disabled={loading}>
        <RefreshCw className={cn("h-4 w-4 sm:mr-1.5", loading && "animate-spin")} />
        <span className="hidden sm:inline">{cal.refresh}</span>
      </Button>
    </div>
  );

  return (
    <div className="ops-page-shell">
      <DashboardPageHeader
        title={cal.title}
        subtitle={cal.subtitle}
        actions={weekNav}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <p>{cal.hint}</p>
        <p className="tabular-nums">{cal.timezoneNote}</p>
        {!loading && !error ? (
          <p className="tabular-nums">
            {t("editorialCalendar.weekSummary", {
              scheduled: scheduledThisWeek,
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
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayItems = byDay[key] || [];
              const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
              return (
                <Card
                  key={key}
                  className={cn("min-h-[168px]", isToday && "ring-1 ring-primary/30")}
                >
                  <CardHeader className="space-y-0 pb-2 pt-4">
                    <CardTitle className="flex items-baseline justify-between text-sm font-semibold">
                      <span>{format(day, "EEE", { locale: dateLocale })}</span>
                      <span className={cn("tabular-nums", isToday ? "text-primary" : "text-muted-foreground")}>
                        {format(day, "d")}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-4">
                    {dayItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">{cal.emptyDay}</p>
                    ) : (
                      dayItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openSchedule(item)}
                          className="w-full rounded-md border border-border/80 p-2 text-left text-xs transition-colors hover:bg-muted/60"
                        >
                          <div className="mb-1 flex flex-wrap gap-1">
                            <Badge variant={statusVariant(item.status)} className="text-[10px]">
                              {statusLabel(item.status, cal)}
                            </Badge>
                            {item.content_type ? (
                              <Badge variant="outline" className="text-[10px]">
                                {item.content_type}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="line-clamp-2 leading-snug">
                            {item.caption || item.niche || item.id.slice(0, 8)}
                          </p>
                          {item.scheduled_at ? (
                            <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                              {format(new Date(item.scheduled_at), "HH:mm")}
                            </p>
                          ) : null}
                          {typeof item.target_count === "number" && item.target_count > 0 ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                              {cal.accounts}: {item.target_count}
                            </p>
                          ) : null}
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {unscheduled.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="section-header text-base font-semibold">
                  {cal.unscheduled} ({unscheduled.length})
                </CardTitle>
                <p className="page-subtitle text-muted-foreground !mt-1">{cal.unscheduledHint}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 pt-0">
                {unscheduled.map((item) => (
                  <Button key={item.id} variant="outline" size="sm" onClick={() => openSchedule(item)}>
                    {item.caption?.slice(0, 40) || item.niche || item.id.slice(0, 8)}
                  </Button>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      <Dialog open={Boolean(editItem)} onOpenChange={(open) => !open && setEditItem(null)}>
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
                onChange={setEditWhen}
                placeholder={cal.pickSlot}
              />
              <p className="text-xs text-muted-foreground">{cal.timezoneNote}</p>
            </div>
            {editItem ? (
              <p className="text-xs text-muted-foreground">
                {cal.status}:{" "}
                <Badge variant={statusVariant(editItem.status)}>
                  {statusLabel(editItem.status, cal)}
                </Badge>
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            {editItem?.generation_job_id ? (
              <Button type="button" variant="outline" asChild>
                <Link href={`/generation-studio?job=${encodeURIComponent(editItem.generation_job_id)}`}>
                  <ExternalLink className="mr-1 h-3.5 w-3.5" />
                  {cal.openStudio}
                </Link>
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditItem(null)}>
                {cal.cancel}
              </Button>
              <Button type="button" onClick={handleSaveSchedule} disabled={saving || !editWhen}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {cal.save}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
