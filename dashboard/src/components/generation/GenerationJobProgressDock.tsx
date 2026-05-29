"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { Loader2, X, Clapperboard } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  TRACKING_CHANGED_EVENT,
  getTrackedGenerationJobIds,
  removeTrackedGenerationJobId,
} from "@/lib/generation-job-tracking";
import toast from "react-hot-toast";
import { useLocale } from "@/components/i18n/LocaleProvider";

type TrackedJobSnapshot = {
  id: string;
  status: string;
  progress: number;
};

const LIVE_STATUSES = new Set(["running", "pending", "cancelling", "draft", "ready"]);

function statusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "cancelled") return "outline";
  if (LIVE_STATUSES.has(status)) return "secondary";
  return "outline";
}

async function fetchTrackedJobs(ids: string[]): Promise<TrackedJobSnapshot[]> {
  const results = await Promise.all(
    ids.map(async (id) => {
      const raw = (await api.generationJobs.get(id)) as {
        id?: string;
        status?: string;
        progress?: number;
      };
      return {
        id: typeof raw?.id === "string" ? raw.id : id,
        status: typeof raw?.status === "string" ? raw.status : "unknown",
        progress: typeof raw?.progress === "number" ? raw.progress : 0,
      };
    })
  );
  return results;
}

export function GenerationJobProgressDock() {
  const { text, t } = useLocale();
  const dock = text.generationDock;
  const pathname = usePathname();
  const [trackedIds, setTrackedIds] = useState<string[]>([]);
  const prevStatusRef = useRef<Record<string, string>>({});

  const syncIds = useCallback(() => {
    setTrackedIds(getTrackedGenerationJobIds());
  }, []);

  useEffect(() => {
    syncIds();
    const onChange = () => syncIds();
    window.addEventListener(TRACKING_CHANGED_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(TRACKING_CHANGED_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [syncIds]);

  const swrKey = trackedIds.length ? (["tracked-generation-jobs", ...trackedIds] as const) : null;

  const { data: jobs, error } = useSWR(
    swrKey,
    (key) => {
      const [, ...ids] = key as [string, ...string[]];
      return fetchTrackedJobs(ids);
    },
    {
      refreshInterval: trackedIds.length ? 2500 : 0,
      revalidateOnFocus: true,
    }
  );

  useEffect(() => {
    if (!jobs?.length) return;
    const prev = prevStatusRef.current;
    const next = { ...prev };
    for (const j of jobs) {
      const was = prev[j.id];
      if (was && LIVE_STATUSES.has(was) && !LIVE_STATUSES.has(j.status)) {
        const shortId = `${j.id.slice(0, 8)}…`;
        if (j.status === "completed") {
          toast.success(t("generationDock.finished", { id: shortId }));
        } else if (j.status === "failed") {
          toast.error(t("generationDock.failed", { id: shortId }));
        } else if (j.status === "cancelled") {
          toast(t("generationDock.cancelled", { id: shortId }), { icon: "\u23F9" });
        }
      }
      next[j.id] = j.status;
    }
    prevStatusRef.current = next;
  }, [jobs, t]);

  const visible = useMemo(() => {
    if (pathname === "/login" || trackedIds.length === 0) return false;
    // Live job column on Generation Studio already tracks the same run.
    if (pathname === "/generation-studio") return false;
    return true;
  }, [pathname, trackedIds.length]);

  const handleDismiss = (jobId: string) => {
    removeTrackedGenerationJobId(jobId);
    syncIds();
  };

  if (!visible || trackedIds.length === 0) return null;

  const list = jobs ?? trackedIds.map((id) => ({ id, status: "\u2026", progress: 0 }));

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 left-4 right-4 z-[200] flex justify-center",
        "md:left-[calc(22rem+1rem)] md:right-4 md:justify-end"
      )}
    >
      <div
        className="pointer-events-auto w-full max-w-md rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
        role="region"
        aria-label={dock.ariaLabel}
      >
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Clapperboard className="h-3.5 w-3.5 shrink-0" />
          <span>{dock.title}</span>
          {error ? <span className="text-destructive">{dock.refreshError}</span> : null}
        </div>
        <ul className="max-h-40 space-y-2 overflow-y-auto pr-0.5">
          {list.map((job) => {
            const live = LIVE_STATUSES.has(job.status);
            const canDismiss = !live;
            return (
              <li
                key={job.id}
                className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {live ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" aria-hidden />
                    ) : null}
                    <span className="truncate font-mono text-[11px] text-foreground" title={job.id}>
                      {job.id.slice(0, 8)}&hellip;
                    </span>
                    <Badge variant={statusBadgeVariant(job.status)} className="shrink-0 text-[10px] capitalize">
                      {job.status}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" asChild>
                      <Link href={`/generation-studio?job=${encodeURIComponent(job.id)}`}>{dock.open}</Link>
                    </Button>
                    {canDismiss ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={dock.dismiss}
                        onClick={() => handleDismiss(job.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Progress value={Math.min(100, Math.max(0, job.progress))} className="h-1.5" />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
