"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import {
  CheckCircle2,
  Clapperboard,
  Loader2,
  Send,
  X,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";

import { useLocale } from "@/components/i18n/LocaleProvider";
import { api } from "@/lib/api";
import {
  dockProgressLine,
  dockStatusTone,
  dockTimestampContext,
  formatDockRelativeTime,
  isDockJobLive,
  resolveDockJobPresentation,
  resolveTrackedJobTitle,
  type DockProgressLabels,
  type DockTimeLabels,
  type TrackedJobEnrich,
  type TrackedJobSnapshot,
} from "@/lib/generation-dock";
import type { JobStepLike } from "@/lib/generation-job-progress";
import {
  TRACKING_CHANGED_EVENT,
  getTrackedGenerationJobIds,
  removeTrackedGenerationJobId,
} from "@/lib/generation-job-tracking";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

async function fetchListEnrich(ids: string[]): Promise<Map<string, TrackedJobEnrich>> {
  const map = new Map<string, TrackedJobEnrich>();
  try {
    const list = (await api.generationJobs.list({ limit: 100 })) as Array<{
      id?: string;
      topic?: string | null;
      caption?: string | null;
      queue_display_title?: string | null;
      publish_intent_id?: string | null;
      publish_intent_status?: string | null;
    }>;
    if (!Array.isArray(list)) return map;
    const idSet = new Set(ids);
    for (const row of list) {
      const id = typeof row?.id === "string" ? row.id : "";
      if (!id || !idSet.has(id)) continue;
      map.set(id, {
        topic: row.topic,
        caption: row.caption,
        queue_display_title: row.queue_display_title,
        publish_intent_id: row.publish_intent_id,
        publish_intent_status: row.publish_intent_status,
      });
    }
  } catch {
    /* list enrich is best-effort */
  }
  return map;
}

async function fetchPublishSnapshots(
  jobs: Array<{ id: string; status: string; publish_intent_id?: string | null }>,
): Promise<Map<string, TrackedJobSnapshot["publish_snapshot"]>> {
  const map = new Map<string, TrackedJobSnapshot["publish_snapshot"]>();
  await Promise.all(
    jobs
      .filter((j) => j.status === "completed" && j.publish_intent_id)
      .map(async (j) => {
        try {
          const intent = await api.generationJobs.getPublishIntent(j.publish_intent_id!);
          map.set(j.id, {
            intentStatus: intent.status,
            targets: intent.targets ?? [],
          });
        } catch {
          /* intent fetch is best-effort */
        }
      }),
  );
  return map;
}

async function fetchTrackedJobs(
  ids: string[],
  untitledFallback: string,
): Promise<TrackedJobSnapshot[]> {
  const enrich = await fetchListEnrich(ids);
  const results = await Promise.all(
    ids.map(async (id) => {
      const raw = (await api.generationJobs.get(id)) as {
        id?: string;
        status?: string;
        progress?: number;
        execution_mode?: string;
        input_payload?: Record<string, unknown>;
        steps?: JobStepLike[];
        created_at?: string;
        updated_at?: string;
      };
      const extra = enrich.get(id);
      const snapshot = {
        id: typeof raw?.id === "string" ? raw.id : id,
        status: typeof raw?.status === "string" ? raw.status : "unknown",
        progress: typeof raw?.progress === "number" ? raw.progress : 0,
        execution_mode: raw?.execution_mode,
        input_payload: raw?.input_payload,
        steps: raw?.steps,
        created_at: raw?.created_at,
        updated_at: raw?.updated_at,
        publish_intent_id: extra?.publish_intent_id ?? null,
        publish_intent_status: extra?.publish_intent_status ?? null,
        topic: extra?.topic,
        caption: extra?.caption,
        queue_display_title: extra?.queue_display_title,
      };
      return {
        ...snapshot,
        title: resolveTrackedJobTitle(snapshot, untitledFallback),
      };
    }),
  );
  const publishSnapshots = await fetchPublishSnapshots(results);
  return results.map((job) => ({
    ...job,
    publish_snapshot: publishSnapshots.get(job.id) ?? null,
  }));
}

function statusBadgeClass(tone: ReturnType<typeof dockStatusTone>): string {
  switch (tone) {
    case "live":
      return "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200";
    case "success":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
    case "publish":
      return "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    default:
      return "border-border bg-muted/50 text-muted-foreground";
  }
}

function StatusIcon({
  tone,
  barMode,
}: {
  tone: ReturnType<typeof dockStatusTone>;
  barMode: "none" | "indeterminate" | "determinate";
}) {
  if (tone === "failed") return <XCircle className="h-3 w-3 shrink-0" aria-hidden />;
  if (tone === "success" || tone === "publish") {
    return tone === "publish" ? (
      <Send className="h-3 w-3 shrink-0" aria-hidden />
    ) : (
      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden />
    );
  }
  if (tone === "live" && barMode !== "none") {
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />;
  }
  return null;
}

export function GenerationJobProgressDock() {
  const { locale, text, t } = useLocale();
  const dock = text.generationDock;
  const gsLive = text.generationStudio.liveJob;
  const pathname = usePathname();
  const [trackedIds, setTrackedIds] = useState<string[]>([]);
  const prevStatusRef = useRef<Record<string, string>>({});
  const titleByIdRef = useRef<Record<string, string>>({});

  const progressLabels: DockProgressLabels = useMemo(
    () => ({
      phaseDraft: gsLive.phaseDraft,
      phaseReady: gsLive.phaseReady,
      phaseStarting: gsLive.phaseStarting,
      phaseSceneGen: gsLive.phaseSceneGen,
      phaseImages: gsLive.phaseImages,
      phaseVideo: gsLive.phaseVideo,
      phaseVideoMotion: gsLive.phaseVideoMotion,
      phaseVideoBolt: gsLive.phaseVideoBolt,
      phaseAssembly: gsLive.phaseAssembly,
      phaseFinalizing: gsLive.phaseFinalizing,
      phaseDone: gsLive.phaseDone,
      phaseFailed: gsLive.phaseFailed,
      phaseCancelled: gsLive.phaseCancelled,
      phaseCancelling: gsLive.phaseCancelling,
      scenesProgress: t("generationStudio.liveJob.scenesProgress"),
      providerWait: gsLive.providerWait,
      estimatedHint: gsLive.estimatedHint,
      elapsed: gsLive.elapsed,
      phaseReadyToPublish: dock.phaseReadyToPublish,
      phasePublished: dock.phasePublished,
      phasePublishing: dock.phasePublishing,
      phasePublishFailed: dock.phasePublishFailed,
    }),
    [dock, gsLive, t],
  );

  const timeLabels: DockTimeLabels = useMemo(
    () => ({
      justNow: dock.timeJustNow,
      secAgo: dock.timeSecAgo,
      minAgo: dock.timeMinAgo,
      hrAgo: dock.timeHrAgo,
      dayAgo: dock.timeDayAgo,
      startedAgo: dock.timeStarted,
      updatedAgo: dock.timeUpdated,
      completedAgo: dock.timeCompleted,
    }),
    [dock],
  );

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

  const swrKey = trackedIds.length
    ? (["tracked-generation-jobs", dock.untitledJob, ...trackedIds] as const)
    : null;

  const { data: jobs, error, isLoading } = useSWR(
    swrKey,
    (key) => {
      const [, untitled, ...ids] = key as [string, string, ...string[]];
      return fetchTrackedJobs(ids, untitled);
    },
    {
      refreshInterval: trackedIds.length ? 2500 : 0,
      revalidateOnFocus: true,
    },
  );

  useEffect(() => {
    if (!jobs?.length) return;
    const prev = prevStatusRef.current;
    const next = { ...prev };
    for (const j of jobs) {
      titleByIdRef.current[j.id] = j.title;
      const was = prev[j.id];
      if (was && isDockJobLive(was) && !isDockJobLive(j.status)) {
        const label = j.title;
        if (j.status === "completed") {
          toast.success(t("generationDock.finished", { title: label }));
        } else if (j.status === "failed") {
          toast.error(t("generationDock.failed", { title: label }));
        } else if (j.status === "cancelled") {
          toast(t("generationDock.cancelled", { title: label }), { icon: "\u23F9" });
        }
      }
      next[j.id] = j.status;
    }
    prevStatusRef.current = next;
  }, [jobs, t]);

  const visible = useMemo(() => {
    if (pathname === "/login" || trackedIds.length === 0) return false;
    if (pathname === "/generation-studio") return false;
    return true;
  }, [pathname, trackedIds.length]);

  const handleDismiss = (jobId: string) => {
    removeTrackedGenerationJobId(jobId);
    syncIds();
  };

  if (!visible || trackedIds.length === 0) return null;

  const list: TrackedJobSnapshot[] | undefined = jobs;
  const showSkeleton = isLoading && !list?.length;

  return (
    <div
      className={cn(
        "pointer-events-none fixed bottom-4 left-4 right-4 z-[200] flex justify-center",
        "md:left-[calc(22rem+1rem)] md:right-4 md:justify-end",
      )}
    >
      <div
        className="pointer-events-auto w-full max-w-md rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80"
        role="region"
        aria-label={dock.ariaLabel}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
            <Clapperboard className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{dock.title}</span>
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-mono">
              {trackedIds.length}
            </Badge>
          </div>
          {error ? <span className="text-[10px] text-destructive">{dock.refreshError}</span> : null}
        </div>

        {showSkeleton ? (
          <ul className="max-h-44 space-y-2 overflow-y-auto pr-0.5">
            {trackedIds.map((id) => (
              <li key={id} className="rounded-md border border-border/60 px-2.5 py-2">
                <Skeleton className="mb-1.5 h-3.5 w-4/5" />
                <Skeleton className="mb-1 h-3 w-1/2" />
                <Skeleton className="h-1.5 w-full" />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="max-h-44 space-y-2 overflow-y-auto pr-0.5">
            {(list ??
              trackedIds.map(
                (id): TrackedJobSnapshot => ({
                  id,
                  status: "…",
                  progress: 0,
                  title: id.slice(0, 8),
                }),
              )).map((job) => {
                const presentation = resolveDockJobPresentation(
                  {
                    status: job.status,
                    progress: job.progress,
                    execution_mode: job.execution_mode,
                    steps: job.steps,
                    publish_intent_status: job.publish_intent_status,
                    publish_snapshot: job.publish_snapshot,
                  },
                  progressLabels,
                  locale,
                );
                const tone = dockStatusTone(job.status, presentation.phaseLabel, {
                  intentStatus:
                    job.publish_snapshot?.intentStatus ?? job.publish_intent_status,
                  targets: job.publish_snapshot?.targets,
                });
                const progressLine = dockProgressLine(presentation);
                const tsContext = dockTimestampContext(job.status);
                const tsIso =
                  tsContext === "started"
                    ? job.created_at
                    : tsContext === "completed"
                      ? job.updated_at ?? job.created_at
                      : job.updated_at ?? job.created_at;
                const relative = formatDockRelativeTime(tsIso, locale, timeLabels, tsContext);
                const live = isDockJobLive(job.status);
                const canDismiss = !live;

                return (
                  <li
                    key={job.id}
                    className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <p
                          className="truncate text-sm font-medium leading-snug text-foreground"
                          title={`${job.title}\n${job.id}`}
                        >
                          {job.title}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn(
                              "h-5 max-w-full gap-1 px-1.5 text-[10px] font-medium normal-case",
                              statusBadgeClass(tone),
                            )}
                          >
                            <StatusIcon tone={tone} barMode={presentation.barMode} />
                            <span className="truncate">{presentation.phaseLabel}</span>
                          </Badge>
                          {progressLine ? (
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {progressLine}
                            </span>
                          ) : null}
                        </div>
                        {relative ? (
                          <p className="text-[10px] text-muted-foreground">{relative}</p>
                        ) : (
                          <p
                            className="font-mono text-[10px] text-muted-foreground/80"
                            title={job.id}
                          >
                            {job.id.slice(0, 8)}…
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button variant="secondary" size="sm" className="h-7 px-2 text-[11px]" asChild>
                          <Link href={`/generation-studio?job=${encodeURIComponent(job.id)}`}>
                            {dock.open}
                          </Link>
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
                    {presentation.barMode === "determinate" ? (
                      <Progress
                        value={Math.min(100, Math.max(0, presentation.barValue))}
                        className="mt-2 h-1"
                      />
                    ) : presentation.barMode === "indeterminate" ? (
                      <div
                        className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"
                        aria-hidden
                      >
                        <div className="h-full w-2/5 animate-pulse rounded-full bg-primary/80" />
                      </div>
                    ) : null}
                  </li>
                );
              },
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
