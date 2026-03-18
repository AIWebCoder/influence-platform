"use client";

import { useState, useEffect, useRef } from "react";
import { Bell, X, ShieldAlert, AlertTriangle, Info } from "lucide-react";

interface Alert {
  id: string;
  account_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

const CONTENT_API = process.env.NEXT_PUBLIC_CONTENT_API_URL || "http://localhost:8000";

export function AlertBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasBanAlert, setHasBanAlert] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch unread count every 60 seconds
  useEffect(() => {
    const fetchUnreadCount = async () => {
      try {
        const res = await fetch(`${CONTENT_API}/alerts/unread/count`);
        const data = await res.json();
        setUnreadCount(data.unread_count || 0);
      } catch {
        // silently fail
      }
    };

    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch alerts when dropdown opens
  useEffect(() => {
    if (!isOpen) return;

    const fetchAlerts = async () => {
      try {
        const res = await fetch(`${CONTENT_API}/alerts`);
        const data: Alert[] = await res.json();
        setAlerts(data.slice(0, 10));
        setHasBanAlert(data.some((a) => a.type === "ban" && !a.is_read));
      } catch {
        setAlerts([]);
      }
    };

    fetchAlerts();
  }, [isOpen]);

  // Close dropdown when clicking outside
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
    try {
      await fetch(`${CONTENT_API}/alerts/read/${alertId}`, { method: "POST" });
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, is_read: true } : a)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silently fail
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "ban":
        return <ShieldAlert className="h-4 w-4 text-red-500 flex-shrink-0" />;
      case "warning":
      case "action_block":
        return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      default:
        return <Info className="h-4 w-4 text-blue-500 flex-shrink-0" />;
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    return `${Math.floor(diffH / 24)}d ago`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Ban banner */}
      {hasBanAlert && (
        <div className="absolute -top-10 right-0 left-0 rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-lg whitespace-nowrap">
          ⚠ Active ban detected — check alerts
        </div>
      )}

      {/* Bell button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
        aria-label="Alerts"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <h3 className="text-sm font-semibold">Alerts</h3>
            <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No alerts</div>
            ) : (
              alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 border-b px-4 py-3 transition-colors last:border-0 ${
                    alert.is_read ? "opacity-60" : "bg-secondary/20"
                  }`}
                >
                  <div className="mt-0.5">{getIcon(alert.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase">
                        {alert.type}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {alert.created_at ? formatTime(alert.created_at) : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-foreground/80 line-clamp-2">{alert.message}</p>
                  </div>
                  {!alert.is_read && (
                    <button
                      onClick={() => markAsRead(alert.id)}
                      className="mt-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
                    >
                      Read
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
