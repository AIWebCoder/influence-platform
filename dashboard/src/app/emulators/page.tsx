"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Monitor, RefreshCw } from "lucide-react";

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

export default function EmulatorsPage() {
  const [data, setData] = useState<EmulatorResponse>({ count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [tick, setTick] = useState(0);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [busyBySerial, setBusyBySerial] = useState<Record<string, boolean>>({});
  const [restartingBySerial, setRestartingBySerial] = useState<Record<string, boolean>>({});
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

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Emulator Displays</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Live UI previews from connected Android emulators.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setControlEnabled((v) => !v)}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium ${
              controlEnabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            }`}
          >
            Control: {controlEnabled ? "ON" : "OFF"}
          </button>
          <button
            type="button"
            disabled={refreshingAll}
            onClick={() => void refreshAllEmulators()}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <RefreshCw className={`h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`} />
            {refreshingAll ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          Loading emulator previews...
        </div>
      ) : data.items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          No connected emulators found. Start Android emulators and ensure ADB sees them.
          {data.error ? <div className="mt-2 text-red-500">{data.error}</div> : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-3">
          {data.items.map((emulator) => (
            <article
              key={emulator.serial}
              className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <header className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  <Monitor className="h-4 w-4" />
                  {emulator.serial}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {emulator.status}
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(refreshingBySerial[emulator.serial])}
                    onClick={() => void refreshEmulator(emulator.serial)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${refreshingBySerial[emulator.serial] ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(restartingBySerial[emulator.serial])}
                    onClick={() => void restartEmulator(emulator.serial)}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {restartingBySerial[emulator.serial] ? "Restarting..." : "Restart emulator"}
                  </button>
                </div>
              </header>
              <div className="bg-zinc-100 dark:bg-zinc-950">
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
              <footer className="px-4 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                Model: {emulator.model || "unknown"}
                {emulator.screen_size
                  ? ` | ${emulator.screen_size.width}x${emulator.screen_size.height}`
                  : ""}
                {errorBySerial[emulator.serial] ? (
                  <span className="ml-2 text-red-500">{errorBySerial[emulator.serial]}</span>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}