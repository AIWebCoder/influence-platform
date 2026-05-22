"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  EmulatorDeviceCard,
  type EmulatorInfo,
} from "@/components/emulators/EmulatorDeviceCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/i18n/LocaleProvider";

type EmulatorResponse = {
  count: number;
  items: EmulatorInfo[];
  error?: string;
};

function EmulatorStatsBar({
  connected,
  online,
  busy,
  labels,
}: {
  connected: number;
  online: number;
  busy: number;
  labels: { connected: string; ready: string; busy: string };
}) {
  const items = [
    { label: labels.connected, value: connected, icon: Smartphone },
    { label: labels.ready, value: online, icon: CheckCircle2 },
    { label: labels.busy, value: busy, icon: RotateCcw },
  ] as const;

  return (
    <div className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30">
      {items.map(({ label, value, icon: Icon }) => (
        <div key={label} className="flex items-center gap-3 px-5 py-3 first:pl-5 last:pr-5">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function EmulatorsPage() {
  const { text, t } = useLocale();
  const e = text.emulators;
  const [data, setData] = useState<EmulatorResponse>({ count: 0, items: [] });
  const [loading, setLoading] = useState(true);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [tick, setTick] = useState(0);
  const [controlEnabled, setControlEnabled] = useState(true);
  const [busyBySerial, setBusyBySerial] = useState<Record<string, boolean>>({});
  const [restartingBySerial, setRestartingBySerial] = useState<Record<string, boolean>>({});
  const [stoppingBySerial, setStoppingBySerial] = useState<Record<string, boolean>>({});
  const [launchingIgBySerial, setLaunchingIgBySerial] = useState<Record<string, boolean>>({});
  const [pressingMenuBySerial, setPressingMenuBySerial] = useState<Record<string, boolean>>({});
  const [refreshingBySerial, setRefreshingBySerial] = useState<Record<string, boolean>>({});
  const [errorBySerial, setErrorBySerial] = useState<Record<string, string | undefined>>({});
  const [rippleBySerial, setRippleBySerial] = useState<
    Record<string, { x: number; y: number; key: number } | undefined>
  >({});
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const dragStartRef = useRef<Record<string, { x: number; y: number; at: number }>>({});
  const lastActionAtRef = useRef<Record<string, number>>({});

  const loadEmulators = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/emulators", {
        cache: "no-store",
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) {
        throw new Error(`API returned status ${res.status}`);
      }
      const payload = (await res.json()) as EmulatorResponse;
      setData(payload);
    } catch {
      setData({ count: 0, items: [], error: e.listFetchError });
    } finally {
      setLoading(false);
    }
  }, [e.listFetchError]);

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
          [serial]: body.error || e.inputFailed,
        }));
        return false;
      }
      setTick((t) => t + 1);
      return true;
    } catch {
      setErrorBySerial((prev) => ({ ...prev, [serial]: e.inputNetworkError }));
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
        const msg = payload.message || payload.phase || e.restartFailed;
        setErrorBySerial((prev) => ({ ...prev, [serial]: msg }));
      }
    } catch {
      setErrorBySerial((prev) => ({ ...prev, [serial]: e.restartNetworkError }));
    } finally {
      setRestartingBySerial((prev) => ({ ...prev, [serial]: false }));
      await loadEmulators();
      setTick((t) => t + 1);
    }
  };

  const endSession = async (serial: string) => {
    if (stoppingBySerial[serial] || restartingBySerial[serial]) return;
    setErrorBySerial((prev) => ({ ...prev, [serial]: undefined }));
    setStoppingBySerial((prev) => ({ ...prev, [serial]: true }));
    try {
      const res = await fetch(
        `/api/emulators/${encodeURIComponent(serial)}/actions/stop`,
        { method: "POST", cache: "no-store" }
      );
      const payload = (await res.json()) as {
        success?: boolean;
        message?: string;
        phase?: string;
      };
      if (!res.ok || !payload.success) {
        const msg = payload.message || payload.phase || e.endSessionFailed;
        setErrorBySerial((prev) => ({ ...prev, [serial]: msg }));
      }
    } catch {
      setErrorBySerial((prev) => ({ ...prev, [serial]: e.endSessionNetworkError }));
    } finally {
      setStoppingBySerial((prev) => ({ ...prev, [serial]: false }));
      await loadEmulators();
      setTick((t) => t + 1);
    }
  };

  const openAppDrawer = async (emulator: EmulatorInfo) => {
    const serial = emulator.serial;
    if (pressingMenuBySerial[serial]) return;
    setErrorBySerial((prev) => ({ ...prev, [serial]: undefined }));
    setPressingMenuBySerial((prev) => ({ ...prev, [serial]: true }));
    const width = emulator.screen_size?.width ?? 1080;
    const height = emulator.screen_size?.height ?? 2400;
    try {
      const res = await fetch(
        `/api/emulators/${encodeURIComponent(serial)}/input/key`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: "app_drawer", width, height }),
          cache: "no-store",
        }
      );
      const body = (await res.json()) as {
        status: string;
        error?: string;
        method?: string;
      };
      if (!res.ok || body.status !== "success") {
        setErrorBySerial((prev) => ({
          ...prev,
          [serial]: body.error || e.appDrawerFailed,
        }));
        return;
      }
      setTick((t) => t + 1);
      window.setTimeout(() => setTick((t) => t + 1), 700);
    } catch {
      setErrorBySerial((prev) => ({
        ...prev,
        [serial]: e.appDrawerNetworkError,
      }));
    } finally {
      setPressingMenuBySerial((prev) => ({ ...prev, [serial]: false }));
    }
  };

  const openInstagram = async (serial: string) => {
    if (launchingIgBySerial[serial]) return;
    const emu = data.items.find((item) => item.serial === serial);
    if (emu && emu.status !== "device") {
      setErrorBySerial((prev) => ({
        ...prev,
        [serial]:
          emu.status === "unauthorized"
            ? e.acceptUsbThenRefresh
            : t("emulators.notReady", { status: emu.status }),
      }));
      return;
    }
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
          [serial]: body.error || e.openInstagramFailed,
        }));
        return;
      }
      setTick((t) => t + 1);
    } catch {
      setErrorBySerial((prev) => ({
        ...prev,
        [serial]: e.openInstagramNetworkError,
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
      setErrorBySerial((prev) => ({ ...prev, [serial]: e.refreshStateFailed }));
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
        return s === "device" || s === "online" || s === "ready" || s === "connected" || s === "running";
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
          stoppingBySerial[item.serial] ||
          launchingIgBySerial[item.serial]
      ).length,
    [data.items, busyBySerial, restartingBySerial, stoppingBySerial, launchingIgBySerial]
  );

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Monitor className="h-6 w-6 text-primary" />
            {e.title}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">{e.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={controlEnabled ? "default" : "outline"}
            onClick={() => setControlEnabled((v) => !v)}
          >
            {controlEnabled ? e.controlOn : e.controlOff}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={refreshingAll}
            onClick={() => void refreshAllEmulators()}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${refreshingAll ? "animate-spin" : ""}`}
            />
            {refreshingAll ? e.refreshingAll : e.refreshAll}
          </Button>
          <Button type="button" size="sm" onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            {e.addEmulator}
          </Button>
        </div>
      </div>

      <AddEmulatorDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdded={() => {
          void loadEmulators();
          setTick((t) => t + 1);
        }}
      />

      {data.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{e.apiErrorTitle}</AlertTitle>
          <AlertDescription>{data.error}</AlertDescription>
        </Alert>
      ) : null}

      <EmulatorStatsBar
        connected={data.count}
        online={onlineCount}
        busy={busyCount}
        labels={{
          connected: e.statsConnected,
          ready: e.statsReady,
          busy: e.statsBusy,
        }}
      />

      {loading ? (
        <div className="mx-auto grid max-w-md gap-6">
          <Card>
            <CardContent className="space-y-4 p-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mx-auto aspect-[9/20] w-full max-w-[280px] rounded-2xl" />
              <Skeleton className="h-3 w-48 mx-auto" />
            </CardContent>
          </Card>
        </div>
      ) : data.items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Smartphone className="h-8 w-8 mx-auto mb-2" />
            <p className="font-medium">{e.emptyTitle}</p>
            <p className="text-sm mt-1">{e.emptyHint}</p>
          </CardContent>
        </Card>
      ) : (
        <div
          className={
            data.items.length === 1
              ? "mx-auto grid max-w-md gap-6"
              : "grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3"
          }
        >
          {data.items.map((emulator) => (
            <EmulatorDeviceCard
              key={emulator.serial}
              emulator={emulator}
              frameUrl={frameUrl(emulator.serial)}
              controlEnabled={controlEnabled}
              busy={Boolean(busyBySerial[emulator.serial])}
              restarting={Boolean(restartingBySerial[emulator.serial])}
              stopping={Boolean(stoppingBySerial[emulator.serial])}
              refreshing={Boolean(refreshingBySerial[emulator.serial])}
              launchingIg={Boolean(launchingIgBySerial[emulator.serial])}
              pressingMenu={Boolean(pressingMenuBySerial[emulator.serial])}
              error={errorBySerial[emulator.serial]}
              ripple={rippleBySerial[emulator.serial]}
              onMouseDown={(event) => onMouseDown(emulator.serial, event)}
              onMouseUp={(event) => void onMouseUp(emulator, event)}
              onRefresh={() => void refreshEmulator(emulator.serial)}
              onRestart={() => void restartEmulator(emulator.serial)}
              onEndSession={() => void endSession(emulator.serial)}
              onOpenInstagram={() => void openInstagram(emulator.serial)}
              onPressMenu={() => void openAppDrawer(emulator)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type AvdResponse = {
  count: number;
  items: string[];
  error?: string;
};

type PreflightResponse = {
  ready?: boolean;
  verdict?:
    | "ready"
    | "no_kvm"
    | "no_accel"
    | "no_emulator_binary"
    | "no_avd"
    | "no_agent_configured"
    | "agent_unreachable"
    | "agent_timeout"
    | "agent_error"
    | "proxy_error"
    | "internal_error"
    | "unknown";
  message?: string;
  emulator_binary?: string | null;
  host_platform?: string;
  kvm?: {
    ready?: boolean;
    backend?: string;
    host_platform?: string;
    has_virt_flag?: boolean;
    dev_kvm_exists?: boolean;
    dev_kvm_readable?: boolean;
    message?: string;
  };
  avds?: string[];
};

type AddEmulatorResult = {
  success?: boolean;
  phase?: string;
  message?: string;
  serial?: string | null;
  avd_name?: string;
  target?: string;
};

function AddEmulatorDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAdded: () => void;
}) {
  const { text, t } = useLocale();
  const e = text.emulators;
  const [mode, setMode] = useState<"launch_avd" | "adb_connect">("launch_avd");
  const [avds, setAvds] = useState<string[]>([]);
  const [avdsLoading, setAvdsLoading] = useState(false);
  const [avdsLoaded, setAvdsLoaded] = useState(false);
  const [avdsError, setAvdsError] = useState<string | undefined>(undefined);
  const [preflight, setPreflight] = useState<PreflightResponse | undefined>(undefined);
  const [selectedAvd, setSelectedAvd] = useState<string>("");
  const [headless, setHeadless] = useState(false);
  const [hostPort, setHostPort] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [successMessage, setSuccessMessage] = useState<string | undefined>(undefined);

  const loadAvds = useCallback(async (): Promise<{ items: string[]; error?: string }> => {
    setAvdsLoading(true);
    setAvdsError(undefined);
    try {
      const res = await fetch("/api/avds", { cache: "no-store" });
      const payload = (await res.json()) as AvdResponse;
      const items = payload.items || [];
      const errMsg = !res.ok
        ? payload.error || `Failed to load AVDs (HTTP ${res.status})`
        : payload.error;
      setAvds(items);
      setAvdsError(errMsg);
      return { items, error: errMsg };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : e.loadAvdsError;
      setAvds([]);
      setAvdsError(errMsg);
      return { items: [], error: errMsg };
    } finally {
      setAvdsLoading(false);
      setAvdsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setAvdsLoaded(false);
      setPreflight(undefined);
      return;
    }
    setErrorMessage(undefined);
    setSuccessMessage(undefined);
    void loadAvds().then((result) => {
      if (result.items.length === 0) {
        setMode("adb_connect");
      } else {
        setMode("launch_avd");
      }
    });
    void fetch("/api/emulators/preflight", { cache: "no-store" })
      .then(async (res) => (await res.json()) as PreflightResponse)
      .then((data) => setPreflight(data))
      .catch(() => setPreflight({ ready: false, verdict: "proxy_error" }));
  }, [open, loadAvds]);

  const launchAvdAvailable = avds.length > 0;
  const showAvdUnavailableAlert = avdsLoaded && !avdsLoading && !launchAvdAvailable;

  const hostPortValid = useMemo(
    () => /^[A-Za-z0-9._-]+:\d{1,5}$/.test(hostPort.trim()),
    [hostPort]
  );

  const handleSubmit = async () => {
    setErrorMessage(undefined);
    setSuccessMessage(undefined);

    const body: Record<string, unknown> = { mode };
    if (mode === "launch_avd") {
      if (!selectedAvd) {
        setErrorMessage(e.pickAvdError);
        return;
      }
      body.avd_name = selectedAvd;
      body.headless = headless;
    } else {
      if (!hostPortValid) {
        setErrorMessage(e.hostPortError);
        return;
      }
      body.host_port = hostPort.trim();
    }

    setSubmitting(true);
    setSuccessMessage(
      mode === "launch_avd" ? e.launchingAvd : undefined,
    );
    try {
      const res = await fetch("/api/emulators/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json()) as AddEmulatorResult;
      if (!res.ok || !payload.success) {
        setErrorMessage(payload.message || payload.phase || `Request failed (HTTP ${res.status})`);
        setSuccessMessage(undefined);
        return;
      }

      const friendlySerial = payload.serial || payload.target || payload.avd_name || "device";
      const phase = payload.phase || "completed";
      const elapsed =
        typeof (payload as { elapsed_ms?: number }).elapsed_ms === "number"
          ? ` (${Math.round((payload as { elapsed_ms: number }).elapsed_ms / 1000)}s)`
          : "";
      setSuccessMessage(
        phase === "completed"
          ? t("emulators.addedSerial", { serial: friendlySerial, elapsed })
          : phase === "unauthorized"
            ? `${payload.message || e.adbUnauthorized}${elapsed}`
            : t("emulators.addedWithPhase", {
                message: payload.message || `${friendlySerial} (${phase})${elapsed}`,
              })
      );
      onAdded();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : e.addNetworkError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{e.addDialogTitle}</DialogTitle>
          <DialogDescription>{e.addDialogDescription}</DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="launch_avd">{e.tabLaunchAvd}</TabsTrigger>
            <TabsTrigger value="adb_connect">{e.tabAdbConnect}</TabsTrigger>
          </TabsList>

          <TabsContent value="launch_avd" className="space-y-3">
            {showAvdUnavailableAlert ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{e.noAvdsTitle}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>
                    {e.noAvdsBody}
                    {avdsError ? (
                      <>
                        {e.noAvdsUpstream}{" "}
                        <code className="font-mono">{avdsError}</code>.
                      </>
                    ) : null}
                  </p>
                  <p>{e.noAvdsHint}</p>
                </AlertDescription>
              </Alert>
            ) : (
              <>
                {preflight && preflight.ready === false && preflight.verdict !== "no_avd" ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>
                      {preflight.verdict === "no_kvm"
                        ? e.preflightNoKvm
                        : preflight.verdict === "no_accel"
                          ? e.preflightNoAccel
                          : e.preflightNotReady}
                    </AlertTitle>
                    <AlertDescription className="space-y-1">
                      <p>{preflight.kvm?.message || preflight.message || e.preflightDefault}</p>
                      {preflight.verdict === "no_kvm" ? <p>{e.preflightKvmHint}</p> : null}
                      {preflight.verdict === "no_accel" &&
                      (preflight.host_platform === "windows" || preflight.kvm?.host_platform === "windows") ? (
                        <p>{e.preflightWindowsHint}</p>
                      ) : preflight.verdict === "no_accel" ? (
                        <p>{e.preflightAccelHint}</p>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="avd-select">{e.availableAvds}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={avdsLoading}
                      onClick={() => void loadAvds()}
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${avdsLoading ? "animate-spin" : ""}`} />
                      {e.reload}
                    </Button>
                  </div>
                  <Select
                    value={selectedAvd}
                    onValueChange={setSelectedAvd}
                    disabled={avdsLoading || avds.length === 0}
                  >
                    <SelectTrigger id="avd-select">
                      <SelectValue
                        placeholder={avdsLoading ? e.loadingAvds : e.pickAvd}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {avds.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={headless}
                    onChange={(event) => setHeadless(event.target.checked)}
                  />
                  {e.headlessLabel}
                </label>
                {headless ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{e.headlessWarning}</p>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="adb_connect" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="host-port">{e.adbTargetLabel}</Label>
              <Input
                id="host-port"
                placeholder="192.168.1.10:5555"
                value={hostPort}
                onChange={(event) => setHostPort(event.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{e.adbTargetHint}</p>
            </div>
          </TabsContent>
        </Tabs>

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>{e.addFailedTitle}</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {successMessage ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>{e.addDoneTitle}</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {e.close}
          </Button>
          <Button
            type="button"
            disabled={
              submitting ||
              (mode === "launch_avd" &&
                (avdsLoading || !selectedAvd || showAvdUnavailableAlert)) ||
              (mode === "adb_connect" && !hostPortValid)
            }
            onClick={() => void handleSubmit()}
          >
            {submitting ? e.adding : mode === "launch_avd" ? e.launchAvdButton : e.connectButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}