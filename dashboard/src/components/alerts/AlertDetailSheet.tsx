"use client";

import Link from "next/link";
import { ExternalLink, Loader2 } from "lucide-react";
import type { PlatformAlert } from "@/lib/alerts";
import { alertIcon, actionLabelKey } from "@/lib/alerts";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type AlertDetailSheetProps = {
  alert: PlatformAlert | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkRead?: (id: string) => void | Promise<void>;
  markingRead?: boolean;
  formatTime: (iso: string) => string;
};

export function AlertDetailSheet({
  alert,
  open,
  onOpenChange,
  onMarkRead,
  markingRead,
  formatTime,
}: AlertDetailSheetProps) {
  const { t } = useLocale();
  if (!alert) return null;

  const Icon = alertIcon(alert.type);
  const actionKey = actionLabelKey(alert.action_url);
  const actionLabel = actionKey
    ? t(`alerts.actions.${actionKey}`)
    : alert.action_label;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 pr-8">
            <Icon className="h-5 w-5 shrink-0 text-amber-500" />
            {t("alerts.detailTitle")}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase">
                {alert.type}
              </span>
              <span className="text-xs text-muted-foreground">
                {alert.created_at ? formatTime(alert.created_at) : ""}
              </span>
              {!alert.is_read ? (
                <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  {t("alerts.unreadBadge")}
                </span>
              ) : null}
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-2">
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {alert.message}
          </p>
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button asChild className="w-full">
            <Link href={alert.action_url} onClick={() => onOpenChange(false)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              {actionLabel}
            </Link>
          </Button>
          <div className="flex w-full gap-2">
            {!alert.is_read && onMarkRead ? (
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                disabled={markingRead}
                onClick={() => void onMarkRead(alert.id)}
              >
                {markingRead ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {t("alerts.read")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              {t("alerts.close")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
