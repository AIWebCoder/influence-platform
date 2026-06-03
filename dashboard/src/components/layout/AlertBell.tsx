"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Bell, X, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { api } from "@/lib/api";
import type { PlatformAlert } from "@/lib/alerts";
import { alertIcon, previewMessage } from "@/lib/alerts";
import { AlertDetailSheet } from "@/components/alerts/AlertDetailSheet";
import { Button } from "@/components/ui/button";

export function AlertBell() {
  const { t } = useLocale();
  const { status: sessionStatus } = useSession();
  const [unreadCount, setUnreadCount] = useState(0);
  const [alerts, setAlerts] = useState<PlatformAlert[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasBanAlert, setHasBanAlert] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<PlatformAlert | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [markingOne, setMarkingOne] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const data = await api.alerts.getUnreadCount();
      setUnreadCount(data.unread_count || 0);
    } catch {
      /* ignore */
    }
  }, []);

  const loadAlerts = useCallback(async () => {
    try {
      const data = (await api.alerts.getAlerts()) as PlatformAlert[];
      setAlerts(data.slice(0, 8));
      setHasBanAlert(data.some((a) => a.type === "ban" && !a.is_read));
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void refreshUnreadCount();
    const interval = setInterval(() => void refreshUnreadCount(), 60_000);
    return () => clearInterval(interval);
  }, [refreshUnreadCount, sessionStatus]);

  useEffect(() => {
    if (!isOpen) return;
    void loadAlerts();
  }, [isOpen, loadAlerts]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const markAsRead = async (alertId: string) => {
    setMarkingOne(true);
    try {
      await api.alerts.markAsRead(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, is_read: true } : a)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setSelectedAlert((prev) => (prev?.id === alertId ? { ...prev, is_read: true } : prev));
      setHasBanAlert(false);
    } finally {
      setMarkingOne(false);
    }
  };

  const markAllAsRead = async () => {
    setMarkingAll(true);
    try {
      await api.alerts.markAllAsRead();
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
      setUnreadCount(0);
      setHasBanAlert(false);
    } finally {
      setMarkingAll(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return t("alerts.justNow");
    if (diffMin < 60) return t("alerts.minutesAgo", { count: diffMin });
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return t("alerts.hoursAgo", { count: diffH });
    return t("alerts.daysAgo", { count: Math.floor(diffH / 24) });
  };

  const openDetail = (alert: PlatformAlert) => {
    setSelectedAlert(alert);
    setSheetOpen(true);
    setIsOpen(false);
  };

  const unreadInList = alerts.filter((a) => !a.is_read).length;

  return (
    <div className="relative" ref={dropdownRef}>
      {hasBanAlert && (
        <div className="absolute -top-10 right-0 left-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-lg whitespace-nowrap">
          {t("alerts.banner")}
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        aria-label={t("alerts.ariaLabel")}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-96 rounded-lg border bg-background shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <h3 className="text-sm font-semibold">{t("alerts.title")}</h3>
            <div className="flex items-center gap-1">
              {(unreadCount > 0 || unreadInList > 0) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={markingAll}
                  onClick={() => void markAllAsRead()}
                >
                  {markingAll ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  {t("alerts.markAllRead")}
                </Button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={t("alerts.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("alerts.none")}
              </div>
            ) : (
              alerts.map((alert) => {
                const Icon = alertIcon(alert.type);
                return (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => openDetail(alert)}
                    className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-secondary/30 ${
                      alert.is_read ? "opacity-60" : "bg-secondary/20"
                    }`}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase">
                          {alert.type}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {alert.created_at ? formatTime(alert.created_at) : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground/80 line-clamp-2">
                        {previewMessage(alert.message, 90)}
                      </p>
                    </div>
                    {!alert.is_read ? (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t px-4 py-2.5">
            <Link
              href="/alerts"
              onClick={() => setIsOpen(false)}
              className="block text-center text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              {t("alerts.viewAll")}
            </Link>
          </div>
        </div>
      )}

      <AlertDetailSheet
        alert={selectedAlert}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onMarkRead={markAsRead}
        markingRead={markingOne}
        formatTime={formatTime}
      />
    </div>
  );
}
