"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { api } from "@/lib/api";
import type { PlatformAlert } from "@/lib/alerts";
import { AlertDetailSheet } from "@/components/alerts/AlertDetailSheet";
import { AlertInboxList } from "@/components/alerts/AlertInboxList";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type FilterTab = "all" | "unread";

export default function AlertsInboxPage() {
  const { t } = useLocale();
  const { status: sessionStatus } = useSession();
  const searchParams = useSearchParams();
  const focusId = searchParams.get("id");

  const [alerts, setAlerts] = useState<PlatformAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [selected, setSelected] = useState<PlatformAlert | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingOne, setMarkingOne] = useState(false);

  const formatTime = useCallback(
    (iso: string) => {
      const d = new Date(iso);
      const now = new Date();
      const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
      if (diffMin < 1) return t("alerts.justNow");
      if (diffMin < 60) return t("alerts.minutesAgo", { count: diffMin });
      const diffH = Math.floor(diffMin / 60);
      if (diffH < 24) return t("alerts.hoursAgo", { count: diffH });
      return t("alerts.daysAgo", { count: Math.floor(diffH / 24) });
    },
    [t],
  );

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await api.alerts.getAlerts(
        filter === "unread" ? false : undefined,
      )) as PlatformAlert[];
      setAlerts(data);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void loadAlerts();
  }, [loadAlerts, sessionStatus]);

  useEffect(() => {
    if (!focusId || alerts.length === 0) return;
    const found = alerts.find((a) => a.id === focusId);
    if (found) {
      setSelected(found);
      setSheetOpen(true);
    }
  }, [focusId, alerts]);

  const unreadCount = useMemo(() => alerts.filter((a) => !a.is_read).length, [alerts]);

  const markAsRead = async (alertId: string) => {
    setMarkingOne(true);
    try {
      await api.alerts.markAsRead(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, is_read: true } : a)));
      setSelected((prev) => (prev?.id === alertId ? { ...prev, is_read: true } : prev));
    } finally {
      setMarkingOne(false);
    }
  };

  const markAllAsRead = async () => {
    setMarkingAll(true);
    try {
      await api.alerts.markAllAsRead();
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
      if (selected) setSelected({ ...selected, is_read: true });
    } finally {
      setMarkingAll(false);
    }
  };

  const handleSelect = (alert: PlatformAlert) => {
    setSelected(alert);
    setSheetOpen(true);
  };

  return (
    <div className="flex flex-1 flex-col gap-6 p-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="page-title flex items-center gap-3 text-zinc-900 dark:text-zinc-50">
            <Bell className="h-9 w-9 text-indigo-500" />
            {t("alerts.inboxTitle")}
          </h2>
          <p className="page-subtitle">{t("alerts.inboxSubtitle")}</p>
        </div>
        {unreadCount > 0 ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={markingAll}
            onClick={() => void markAllAsRead()}
          >
            {markingAll ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("alerts.markAllRead")}
          </Button>
        ) : null}
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterTab)}>
        <TabsList>
          <TabsTrigger value="all">{t("alerts.filterAll")}</TabsTrigger>
          <TabsTrigger value="unread">
            {t("alerts.filterUnread")}
            {unreadCount > 0 ? ` (${unreadCount})` : ""}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : alerts.length === 0 ? (
        <p className="rounded-lg border border-dashed py-16 text-center text-sm text-muted-foreground">
          {filter === "unread" ? t("alerts.noneUnread") : t("alerts.none")}
        </p>
      ) : (
        <AlertInboxList
          alerts={alerts}
          selectedId={selected?.id ?? null}
          onSelect={handleSelect}
          formatTime={formatTime}
        />
      )}

      <AlertDetailSheet
        alert={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onMarkRead={markAsRead}
        markingRead={markingOne}
        formatTime={formatTime}
      />
    </div>
  );
}
