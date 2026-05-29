"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { enUS, fr as frLocale } from "date-fns/locale";
import toast from "react-hot-toast";

import { api, formatContentApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
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

export default function CalendarPage() {
  const { locale, text } = useLocale();
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

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <CalendarDays className="h-6 w-6 text-primary" />
            {cal.title}
          </h2>
          <p className="text-sm text-muted-foreground">{cal.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">{cal.hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekAnchor((w) => subWeeks(w, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekAnchor(startOfWeek(new Date(), { weekStartsOn: 1 }))}>
            {cal.thisWeek}
          </Button>
          <Button variant="outline" size="icon" onClick={() => setWeekAnchor((w) => addWeeks(w, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
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
          <div className="grid gap-4 md:grid-cols-7">
            {days.map((day) => {
              const key = format(day, "yyyy-MM-dd");
              const dayItems = byDay[key] || [];
              return (
                <Card key={key} className="min-h-[160px]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">
                      {format(day, "EEE d", { locale: dateLocale })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {dayItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">—</p>
                    ) : (
                      dayItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => openSchedule(item)}
                          className="w-full rounded-md border p-2 text-left text-xs transition-colors hover:bg-muted/60"
                        >
                          <div className="mb-1 flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-[10px]">
                              {item.status}
                            </Badge>
                            {item.content_type ? (
                              <Badge variant="secondary" className="text-[10px]">
                                {item.content_type}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="line-clamp-2">{item.caption || item.niche || item.id.slice(0, 8)}</p>
                          {item.scheduled_at ? (
                            <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
                              {format(new Date(item.scheduled_at), "HH:mm")}
                            </p>
                          ) : null}
                          {typeof item.target_count === "number" && item.target_count > 0 ? (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
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
              <CardHeader>
                <CardTitle className="text-base">
                  {cal.unscheduled} ({unscheduled.length})
                </CardTitle>
                <p className="text-sm text-muted-foreground">{cal.unscheduledHint}</p>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
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
            </div>
            {editItem ? (
              <p className="text-xs text-muted-foreground">
                {cal.status}: <Badge variant="outline">{editItem.status}</Badge>
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
