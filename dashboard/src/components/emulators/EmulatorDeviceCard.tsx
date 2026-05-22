"use client";

import type { MouseEvent } from "react";
import {
  AlertCircle,
  Instagram,
  Menu,
  Monitor,
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
  refreshing: boolean;
  launchingIg: boolean;
  pressingMenu: boolean;
  error?: string;
  ripple?: { x: number; y: number; key: number };
  onMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onMouseUp: (event: MouseEvent<HTMLDivElement>) => void;
  onRefresh: () => void;
  onRestart: () => void;
  onOpenInstagram: () => void;
  onPressMenu: () => void;
};

function statusBadgeVariant(status: string): "default" | "destructive" | "secondary" {
  if (status === "device") return "default";
  if (status === "unauthorized") return "destructive";
  return "secondary";
}

function statusLabel(status: string): string {
  if (status === "device") return "Ready";
  if (status === "unauthorized") return "ADB unauthorized";
  if (status === "offline") return "Booting";
  return status;
}

export function EmulatorDeviceCard({
  emulator,
  frameUrl,
  controlEnabled,
  busy,
  restarting,
  refreshing,
  launchingIg,
  pressingMenu,
  error,
  ripple,
  onMouseDown,
  onMouseUp,
  onRefresh,
  onRestart,
  onOpenInstagram,
  onPressMenu,
}: EmulatorDeviceCardProps) {
  const sw = emulator.screen_size?.width ?? 1080;
  const sh = emulator.screen_size?.height ?? 2400;
  const resolution = `${sw}×${sh}`;
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
              {emulator.model || "Unknown model"} · {resolution}
            </p>
          </div>
          <Badge variant={statusBadgeVariant(emulator.status)} className="shrink-0">
            {statusLabel(emulator.status)}
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
                  disabled={actionsDisabled || launchingIg}
                  onClick={onOpenInstagram}
                  aria-label="Open Instagram"
                >
                  <Instagram
                    className={cn(
                      "h-4 w-4 text-pink-500",
                      launchingIg && "animate-pulse"
                    )}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open Instagram</TooltipContent>
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
                  aria-label="Open app drawer"
                >
                  <Menu className={cn("h-4 w-4", pressingMenu && "animate-pulse")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Swipe up — open app drawer</TooltipContent>
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
                  aria-label="Refresh preview"
                >
                  <RefreshCw
                    className={cn("h-4 w-4", refreshing && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh preview</TooltipContent>
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
                  aria-label="Restart emulator"
                >
                  <RotateCcw
                    className={cn("h-4 w-4", restarting && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Restart emulator</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </CardHeader>

      <CardContent className="flex flex-col items-center gap-3 px-4 py-6">
        {emulator.status === "unauthorized" ? (
          <Alert variant="destructive" className="w-full max-w-sm py-2">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              Accept USB debugging on the emulator window, then refresh.
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
              alt={`Live preview ${emulator.serial}`}
              className="h-full w-full select-none object-contain"
              draggable={false}
            />
            {(busy || emulator.busy) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs font-medium text-white backdrop-blur-[1px]">
                Sending input…
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
          {controlEnabled
            ? "Tap or drag on the screen; use ☰ for a precise app-drawer swipe"
            : "Enable Control in the toolbar to send taps and swipes"}
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
