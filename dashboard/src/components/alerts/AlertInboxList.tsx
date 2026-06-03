"use client";

import { cn } from "@/lib/utils";
import type { PlatformAlert } from "@/lib/alerts";
import { alertIcon, previewMessage } from "@/lib/alerts";

type AlertInboxListProps = {
  alerts: PlatformAlert[];
  selectedId: string | null;
  onSelect: (alert: PlatformAlert) => void;
  formatTime: (iso: string) => string;
  compact?: boolean;
};

export function AlertInboxList({
  alerts,
  selectedId,
  onSelect,
  formatTime,
  compact = false,
}: AlertInboxListProps) {
  return (
    <ul className={cn("divide-y", compact ? "" : "rounded-lg border bg-card")}>
      {alerts.map((alert) => {
        const Icon = alertIcon(alert.type);
        const selected = selectedId === alert.id;
        return (
          <li key={alert.id}>
            <button
              type="button"
              onClick={() => onSelect(alert)}
              className={cn(
                "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/40",
                selected && "bg-secondary/50",
                !alert.is_read && !selected && "bg-secondary/20",
                alert.is_read && "opacity-75",
              )}
            >
              <Icon
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  alert.type === "ban" ? "text-red-500" : "text-amber-500",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase">
                    {alert.type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {alert.created_at ? formatTime(alert.created_at) : ""}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-1 text-foreground/90",
                    compact ? "line-clamp-2 text-xs" : "line-clamp-3 text-sm",
                  )}
                >
                  {compact ? previewMessage(alert.message, 100) : previewMessage(alert.message, 200)}
                </p>
              </div>
              {!alert.is_read ? (
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
