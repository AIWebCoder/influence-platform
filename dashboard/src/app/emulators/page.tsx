"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Instagram,
  Monitor,
  RefreshCw,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

type EmulatorInfo = {
  serial: string;
  status: string;
  model?: string | null;
  busy?: boolean;
  screen_size?: { width: number; height: number } | null;
};

type EmulatorResponse = {
  count: number;
  items: EmulatorInfo[];
  error?: string;
};

function StatCard({
  title,
  value,
  icon: Icon,
  sub,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
            {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmulatorsPage() {
  const [data, setData] = useState<EmulatorResponse>({ count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [tick, setTick] = useState(0);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [busyBySerial, setBusyBySerial] = useState<Record<string, boolean>>({});
  const [restartingBySerial, setRestartingBySerial] = useState<Record<string, boolean>>({});
  const [launchingIgBySerial, setLaunchingIgBySerial] = useState<Record<string, boolean>>({});
  const [refreshingBySerial, setRefreshingBySerial] = useState<Record<string, boolean>>({});
  const [errorBySerial, setErrorBySerial] = useState<Record<string, string | undefined>>({});
  const [rippleBySerial, setRippleBySerial] = useState<
    Record<string, { x: number; y: number; key: number } | undefined>
  >({});
  const dragStartRef = useRef<Record<string, { x: number; y: number; at: number }>>({});
  const lastActionAtRef = useRef<Record<string, number>>({});

  const loadEmulators = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/emulators", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`API returned status ${res.status}`);
      }
      const payload = (await res.json()) as EmulatorResponse;
      setData(payload);
    } catch {
      setData({ count: 0, items: [], error: "Unable to fetch emulator list" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEmulators();
    const interval = setInterval(() => {
      void loadEmulators();
      setTick((t) => t + 1);
    }, 5000);
    return () => {
      clearInterval(interval);
    };
  }, [loadEmulators]);

  const frameUrl = useMemo(
    () => (serial: string) => `/api/emulators/${encodeURIComponent(serial)}/frame?t=${tick}`,
    [tick]
  );

  const mapToDeviceCoordinates = (
    rect: DOMRect,
    clientX: number,
    clientY: number,
    emulator: EmulatorInfo
  ): { x: number; y: number } | null => {
    if (rect.width <= 0 || rect.height <= 0) return null;
    const width = emulator.screen_size?.width ?? 1080;
    const height = emulator.screen_size?.height ?? 2400;

    const px = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    const py = Math.min(Math.max(clientY - rect.top, 0), rect.height);

    return {
      x: Math.round((px / rect.width) * width),
      y: Math.round((py / rect.height) * height),
    };
  };

  const runAction = async (
    serial: string,
    path: "tap" | "swipe",
    payload: Record<string, number>
  ): Promise<boolean> => {
    setErrorBySerial((prev) => ({ ...prev, [serial]: undefined }));
    setBusyBySerial((prev) => ({ ...prev, [serial]: true }));
    try {
      const res = await fetch(`/api/emulators/${encodeURIComponent(serial)}/input/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`API error ${res.status}`);
      }
      const body = (await res.json()) as { status: string; error?: string };
      if (!res.ok || body.status !== "success") {
        setErrorBySerial((prev) => ({
          ...prev,
          [serial]: body.error || "Input action failed",
        }));
        return false;
      }
      setTick((t) => t + 1);
      return true;
    } catch {
      setErrorBySerial((prev) => ({ ...prev, [serial]: "Network error while sending input" }));
      return false;
    } finally {
      setBusyBySerial((prev) => ({ ...prev, [serial]: false }));
    }
  };

  const restartEmulator = async (serial: string) => {
    if (restartingBySerial[serial]) return;
    setErrorBySerial((prev) => ({ ...prev, [serial]: undefined }));
    setRestartingBySerial((prev) => ({ ...prev, [serial]: true }));
    try {
      const res = await fetch("/api/emulators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial }),
        cache: "no-store",
      });
      const payload = (await res.json()) as {
        success?: boolean;
        message?: string;
        phase?: string;
      };
      if (!res.ok || !payload.success) {
        const msg = payload.message || payload.phase || "Restart failed";
        setErrorBySerial((prev) => ({ ...prev, [serial]: msg }));
      }
    } catch {
      setErrorBySerial((prev) => ({ ...prev, [serial]: "Network error during restart" }));
    } finally {
      setRestartingBySerial((prev) => ({ ...prev, [serial]: false }));
      await loadEmulators();
      setTick((t) => t + 1);
    }
  };

  const openInstagram = async (serial: string) => {
    if (launchingIgBySerial[serial]) return;
    setErrorBySerial((prev) => ({ ...prev, [serial]: undefined }));
    setLaunchingIgBySerial((prev) => ({ ...prev, [serial]: true }));
    try {
      const res = await fetch(
        `/api/emulators/${encodeURIComponent(serial)}/apps/instagram`,
        { method: "POST", cache: "no-store" }
      );
      const body = (await res.json()) as { status: string; error?: string };
      if (!res.ok || body.status !== "success") {
        setErrorBySerial((prev) => ({
          ...prev,
          [serial]: body.error || "Failed to open Instagram",
        }));
        return;
      }
      setTick((t) => t + 1);
    } catch {
      setErrorBySerial((prev) => ({
        ...prev,
        [serial]: "Network error while opening Instagram",
      }));
    } finally {
      setLaunchingIgBySerial((prev) => ({ ...prev, [serial]: false }));
    }
  };

  const refreshEmulator = async (serial: string) => {
    if (refreshingBySerial[serial]) return;
    setErrorBySerial((prev) => ({ ...prev, [serial]: undefined }));
    setRefreshingBySerial((prev) => ({ ...prev, [serial]: true }));
    try {
      await loadEmulators();
      setTick((t) => t + 1);
    } catch {
      setErrorBySerial((prev) => ({ ...prev, [serial]: "Failed to refresh emulator state" }));
    } finally {
      setRefreshingBySerial((prev) => ({ ...prev, [serial]: false }));
    }
  };

  const refreshAllEmulators = async () => {
    if (refreshingAll) return;
    setRefreshingAll(true);
    try {
      await loadEmulators();
      setTick((t) => t + 1);
    } finally {
      setRefreshingAll(false);
    }
  };

  const onMouseDown = (serial: string, event: MouseEvent<HTMLDivElement>) => {
    if (!controlEnabled || busyBySerial[serial]) return;
    dragStartRef.current[serial] = { x: event.clientX, y: event.clientY, at: Date.now() };
  };

  const onMouseUp = async (emulator: EmulatorInfo, event: MouseEvent<HTMLDivElement>) => {
    if (!controlEnabled) return;
    const serial = emulator.serial;
    if (busyBySerial[serial] || emulator.busy) return;

    const now = Date.now();
    const last = lastActionAtRef.current[serial] || 0;
    if (now - last < 120) return;
    lastActionAtRef.current[serial] = now;

    const start = dragStartRef.current[serial];
    if (!start) return;
    delete dragStartRef.current[serial];

    const rect = event.currentTarget.getBoundingClientRect();
    const startMapped = mapToDeviceCoordinates(rect, start.x, start.y, emulator);
    const endMapped = mapToDeviceCoordinates(rect, event.clientX, event.clientY, emulator);
    if (!startMapped || !endMapped) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const distance = Math.hypot(dx, dy);
    const dragDuration = Math.max(120, Math.min(900, now - start.at));

    setRippleBySerial((prev) => ({
      ...prev,
      [serial]: {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        key: now,
      },
    }));

    if (distance < 10) {
      await runAction(serial, "tap", { x: endMapped.x, y: endMapped.y });
      return;
    }

    await runAction(serial, "swipe", {
      x1: startMapped.x,
      y1: startMapped.y,
      x2: endMapped.x,
      y2: endMapped.y,
      duration: dragDuration,
    });
  };

  const onlineCount = useMemo(
    () =>
      data.items.filter((item) => {
        const s = (item.status || "").toLowerCase();
        return s === "online" || s === "ready" || s === "connected" || s === "running";
      }).length,
    [data.items]
  );

  const busyCount = useMemo(
    () =>
      data.items.filter(
        (item) =>
          item.busy ||
          busyBySerial[item.serial] ||
          restartingBySerial[item.serial] ||
          launchingIgBySerial[item.serial]
      ).length,
    [data.items, busyBySerial, restartingBySerial, launchingIgBySerial]
  );

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Monitor className="h-6 w-6 text-primary" />
            Emulator Displays
          </h1>
          <p className="text-sm text-muted-foreground">
            Live UI previews from connected Android emulators.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant={controlEnabled ? "default" : "outline"}
            onClick={() => setControlEnabled((v) => !v)}
          >
            Control: {controlEnabled ? "ON" : "OFF"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={refreshingAll}
            onClick={() => void refreshAllEmulators()}
          >
            <RefreshCw className={`h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`} />
            {refreshingAll ? "Refreshing..." : "Refresh now"}
          </Button>
        </div>
      </div>

      {data.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Emulator API Error</AlertTitle>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard title="Connected" value={data.count} icon={Smartphone} />
        <StatCard title="Online" value={onlineCount} icon={CheckCircle2} />
        <StatCard title="Busy" value={busyCount} icon={RotateCcw} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-40" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-[420px] w-full" />
                <Skeleton className="h-4 w-56" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Smartphone className="h-8 w-8 mx-auto mb-2" />
            <p className="font-medium">No connected emulators found.</p>
            <p className="text-sm mt-1">
              Start Android emulators and ensure ADB sees them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-3">
          {data.items.map((emulator) => (
            <Card key={emulator.serial} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-muted-foreground" />
                    {emulator.serial}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{emulator.status}</Badge>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        Boolean(launchingIgBySerial[emulator.serial]) ||
                        Boolean(busyBySerial[emulator.serial]) ||
                        Boolean(emulator.busy)
                      }
                      onClick={() => void openInstagram(emulator.serial)}
                      title="Launch Instagram on this emulator via ADB"
                    >
                      <Instagram
                        className={`mr-1 h-3.5 w-3.5 text-pink-500 ${launchingIgBySerial[emulator.serial] ? "animate-pulse" : ""}`}
                      />
                      {launchingIgBySerial[emulator.serial] ? "Opening…" : "Instagram"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(refreshingBySerial[emulator.serial])}
                      onClick={() => void refreshEmulator(emulator.serial)}
                    >
                      <RefreshCw
                        className={`mr-1 h-3.5 w-3.5 ${refreshingBySerial[emulator.serial] ? "animate-spin" : ""}`}
                      />
                      Refresh
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={Boolean(restartingBySerial[emulator.serial])}
                      onClick={() => void restartEmulator(emulator.serial)}
                    >
                      {restartingBySerial[emulator.serial] ? "Restarting..." : "Restart"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="bg-zinc-100 dark:bg-zinc-950 rounded-md overflow-hidden">
                  <div
                    className={`relative h-[520px] w-full ${
                      controlEnabled ? "cursor-crosshair" : "cursor-default"
                    }`}
                    onMouseDown={(event) => onMouseDown(emulator.serial, event)}
                    onMouseUp={(event) => void onMouseUp(emulator, event)}
                  >
                    <img
                      src={frameUrl(emulator.serial)}
                      alt={`Live frame for ${emulator.serial}`}
                      className="h-[520px] w-full select-none object-contain"
                      draggable={false}
                    />
                    {(busyBySerial[emulator.serial] || emulator.busy) && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-xs font-medium text-white">
                        Executing action...
                      </div>
                    )}
                    {rippleBySerial[emulator.serial] && (
                      <span
                        key={rippleBySerial[emulator.serial]?.key}
                        className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400"
                        style={{
                          left: rippleBySerial[emulator.serial]?.x,
                          top: rippleBySerial[emulator.serial]?.y,
                        }}
                      />
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Model: {emulator.model || "unknown"}
                  {emulator.screen_size
                    ? ` | ${emulator.screen_size.width}x${emulator.screen_size.height}`
                    : ""}
                  {errorBySerial[emulator.serial] ? (
                    <span className="ml-2 text-destructive">{errorBySerial[emulator.serial]}</span>
                  ) : null}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}