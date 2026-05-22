"use client";

import type { MouseEvent } from "react";
import {
  AlertCircle,
  Instagram,
  Menu,
  Monitor,
  Power,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/utils";

export type EmulatorInfo = {
  serial: string;
  status: string;
  model?: string | null;
  busy?: boolean;
  screen_size?: { width: number; height: number } | null;
};

type EmulatorDeviceCardProps = {
  emulator: EmulatorInfo;
  frameUrl: string;
  controlEnabled: boolean;
  busy: boolean;
  restarting: boolean;
  stopping: boolean;
  refreshing: boolean;
  launchingIg: boolean;
  pressingMenu: boolean;
  error?: string;
  ripple?: { x: number; y: number; key: number };
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp: (event: MouseEvent<HTMLDivElement>) => void;
  onRefresh: () => void;
  onRestart: () => void;
  onEndSession: () => void;
  onOpenInstagram: () => void;
  onPressMenu: () => void;
};

function statusBadgeVariant(status: string): "default" | "destructive" | "secondary" {
  if (status === "device") return "default";
  if (status === "unauthorized") return "destructive";
  return "secondary";
}

function statusLabel(
  status: string,
  labels: { ready: string; unauthorized: string; booting: string }
): string {
  if (status === "device") return labels.ready;
  if (status === "unauthorized") return labels.unauthorized;
  if (status === "offline") return labels.booting;
  return status;
}

export function EmulatorDeviceCard({
  emulator,
  frameUrl,
  controlEnabled,
  busy,
  restarting,
  stopping,
  refreshing,
  launchingIg,
  pressingMenu,
  error,
  ripple,
  onMouseDown,
  onMouseUp,
  onRefresh,
  onRestart,
  onEndSession,
  onOpenInstagram,
  onPressMenu,
}: EmulatorDeviceCardProps) {
  const { text, t } = useLocale();
  const e = text.emulators;
  const sw = emulator.screen_size?.width ?? 1080;
  const sh = emulator.screen_size?.height ?? 2400;
  const resolution = `${sw}x${sh}`;
  const actionsDisabled = busy || Boolean(emulator.busy);

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="space-y-3 border-b bg-muted/20 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Monitor className="h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="truncate font-mono text-sm font-medium">{emulator.serial}</p>
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {emulator.model || e.unknownModel} | {resolution}
            </p>
          </div>
          <Badge variant={statusBadgeVariant(emulator.status)} className="shrink-0">
            {statusLabel(emulator.status, {
              ready: e.statusReady,
              unauthorized: e.statusUnauthorized,
              booting: e.statusBooting,
            })}
          </Badge>
        </div>

        <TooltipProvider delayDuration={300}>
          <div className="flex items-center justify-end gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={
                    actionsDisabled ||
                    launchingIg ||
                    emulator.status !== "device"
                  }
                  onClick={onOpenInstagram}
                  aria-label={e.openInstagram}
                >
                  <Instagram
                    className={cn(
                      "h-4 w-4 text-pink-500",
                      launchingIg && "animate-pulse"
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{e.openInstagram}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={actionsDisabled || pressingMenu}
                  onClick={onPressMenu}
                  aria-label={e.openAppDrawer}
                >
                  <Menu className={cn("h-4 w-4", pressingMenu && "animate-pulse")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{e.openAppDrawer}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={refreshing}
                  onClick={onRefresh}
                  aria-label={e.refreshPreview}
                >
                  <RefreshCw
                    className={cn("h-4 w-4", refreshing && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{e.refreshPreview}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={restarting}
                  onClick={onRestart}
                  aria-label={e.restartEmulator}
                >
                  <RotateCcw
                    className={cn("h-4 w-4", restarting && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{e.restartEmulator}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  disabled={stopping || actionsDisabled}
                  onClick={onEndSession}
                  aria-label={e.endSession}
                >
                  <Power className={cn("h-4 w-4", stopping && "animate-pulse")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{e.endSession}</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </CardHeader>

      <CardContent className="flex flex-col items-center gap-3 px-4 py-6">
        {emulator.status === "unauthorized" ? (
          <Alert variant="destructive" className="w-full max-w-sm py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              {e.unauthorizedHint}
            </AlertDescription>
          </Alert>
        ) : null}

        <div
          className="w-full max-w-[min(100%,280px)] rounded-2xl border border-border/60 bg-zinc-950/80 p-2 shadow-inner"
          style={{ aspectRatio: `${sw} / ${sh}` }}
        >
          <div
            className={cn(
              "relative h-full w-full overflow-hidden rounded-xl bg-zinc-900",
              controlEnabled ? "cursor-crosshair" : "cursor-default"
            )}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
          >
            <img
              src={frameUrl}
              alt={t("emulators.livePreviewAlt", { serial: emulator.serial })}
              className="h-full w-full select-none object-contain"
              draggable={false}
            />
            {(busy || emulator.busy) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white backdrop-blur-[1px]">
                {e.sendingInput}
              </div>
            )}
            {ripple && (
              <span
                key={ripple.key}
                className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400"
                style={{ left: ripple.x, top: ripple.y }}
              />
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          {controlEnabled ? e.controlHintOn : e.controlHintOff}
        </p>
      </CardContent>

      {error ? (
        <CardFooter className="border-t bg-destructive/5 px-4 py-2">
          <p className="text-xs text-destructive">{error}</p>
        </CardFooter>
      ) : null}
    </Card>
  );
}
