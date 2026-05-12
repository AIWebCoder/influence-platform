"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { api, formatContentApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  GripVertical,
  Loader2,
  Maximize2,
  RefreshCw,
  Rocket,
  SkipForward,
  Sparkles,
  Square,
  Video,
  XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { addTrackedGenerationJobId } from "@/lib/generation-job-tracking";

type ContentType = "post" | "reel" | "story";
type Mode = "persona" | "faceless";
type ExecutionMode = "scene_based" | "multi_scene_single_video" | "ailiveai_single_video";
/** AliveAI Create Prompt gender (blocking portrait + persona text). */
type AiliveaiGender = "FEMALE" | "MALE" | "TRANS";
type PublishMode = "publish_now" | "save_for_later" | "scheduled";

type DraftScene = {
  scene_index: number;
  prompt: string;
  duration: number;
  role?: string;
};

type JobStep = {
  id: string;
  step_name: string;
  status: string;
  progress: number;
  metadata: Record<string, unknown>;
  error_message?: string | null;
};

type SceneMetadata = {
  preview_image_url?: string;
  preview_video_url?: string;
  preview_kind?: string;
};

type JobScene = {
  id: string;
  scene_index: number;
  prompt: string;
  duration: number;
  scene_role?: string | null;
  status: string;
  start_image_url?: string | null;
  end_image_url?: string | null;
  video_url?: string | null;
  error_message?: string | null;
  metadata?: SceneMetadata;
};

type GenerationJobDetail = {
  id: string;
  status: string;
  progress: number;
  step_control?: Record<string, string>;
  input_payload: Record<string, unknown>;
  output_url?: string | null;
  logs: Array<{ ts?: string; level?: string; message?: string }>;
  steps: JobStep[];
  scenes: JobScene[];
  cost_estimate?: {
    total_credits: number;
    currency: string;
    model?: string;
    provider?: string;
    estimate_note?: string;
    breakdown: Array<{ line: string; units: number; unit_credits: number; subtotal: number }>;
  } | null;
};

type DistributionAccount = {
  id?: string;
  username?: string;
};

type GeneratedAsset = {
  id: string;
  generation_job_id: string;
  asset_type: "image" | "video" | "thumbnail";
  storage_provider: string;
  object_key: string;
  public_url: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  width?: number | null;
  height?: number | null;
  checksum_sha256: string;
  status: "ready";
  created_at?: string | null;
  updated_at?: string | null;
};

type PublishIntentResponse = {
  intent_id: string;
  status: string;
  targets: Array<{ account_id: string; platform: string; status: string }>;
};

const NICHE_OPTIONS = ["fitness", "food", "travel", "business", "lifestyle"] as const;

const TOPIC_PLACEHOLDER_BY_NICHE: Record<(typeof NICHE_OPTIONS)[number], string> = {
  fitness: "e.g. morning mobility routine for desk workers",
  food: "e.g. high-protein meal prep under 30 minutes",
  travel: "e.g. long weekend in Lisbon on a budget",
  business: "e.g. first marketing hires for a B2B startup",
  lifestyle: "e.g. simple habits for a calmer morning",
};

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed" || status === "queued") return "default";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "ready" || status === "cancelling") return "secondary";
  if (status === "cancelled") return "outline";
  return "outline";
}

function stepMetadataSkipped(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.skipped === true;
}

function pipelineStepSkipHint(metadata: Record<string, unknown> | undefined): string | null {
  if (!stepMetadataSkipped(metadata)) return null;
  const reason = metadata?.reason;
  if (reason === "single_seedance_video_path") {
    return "Not used in Seedance single-video mode (one video pass, no per-scene images).";
  }
  if (reason === "ailiveai_single_video_path") {
    return "Not used in AILIVEAI single-video mode (one video pass, no per-scene images).";
  }
  if (reason === "single_video_no_assembly_required") {
    return "Not used — final output is a single clip with no assembly step.";
  }
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }
  return "Skipped for this execution mode.";
}

/** Local wall-clock time (24h) from step metadata ISO timestamp set when video_generation begins. */
function formatVideoGenExecutionStart(metadata: Record<string, unknown> | undefined): string | null {
  const raw = metadata?.execution_started_at;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function StepIcon({ status, skipped }: { status: string; skipped?: boolean }) {
  if (status === "completed" && skipped) {
    return (
      <span title="Skipped for this execution mode" className="inline-flex">
        <SkipForward className="h-4 w-4 text-muted-foreground" aria-hidden />
      </span>
    );
  }
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "cancelled") return <Square className="h-4 w-4 text-muted-foreground" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-amber-600" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function parseHashtags(value: string): string[] {
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => (x.startsWith("#") ? x : `#${x}`));
}

function PublishPanel({
  jobId,
  assets,
  accounts,
  publishNiche,
  publishTopic,
}: {
  jobId: string;
  assets: GeneratedAsset[];
  accounts: Array<{ id: string; username: string }>;
  publishNiche: string;
  publishTopic: string;
}) {
  const reelEnabledRaw =
    process.env.NEXT_PUBLIC_FEATURE_INSTAGRAM_REEL_PUBLISH_ENABLED ??
    "true";
  const reelEnabled = String(reelEnabledRaw).toLowerCase() === "true";

  const defaultAssetId = useMemo(() => {
    if (assets.length === 0) return "";
    const firstVideo = assets.find((a) => a.asset_type === "video");
    return firstVideo?.id || assets[0].id;
  }, [assets]);

  const [selectedAssetId, setSelectedAssetId] = useState<string>(defaultAssetId);
  const [contentType, setContentType] = useState<ContentType>("post");
  const [caption, setCaption] = useState("");
  const [hashtagsInput, setHashtagsInput] = useState("");
  const [mode, setMode] = useState<PublishMode>("publish_now");
  const [scheduledFor, setScheduledFor] = useState<Date | undefined>(undefined);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [immediateLoading, setImmediateLoading] = useState(false);
  const [captionGenLoading, setCaptionGenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResponse, setSuccessResponse] = useState<PublishIntentResponse | null>(null);
  const postNowInFlightRef = useRef(false);

  useEffect(() => {
    setSelectedAssetId(defaultAssetId);
  }, [defaultAssetId]);

  const accountSummary = useMemo(() => {
    if (selectedAccounts.length === 0) return "Select target accounts";
    const labels = selectedAccounts
      .map((id) => accounts.find((a) => a.id === id)?.username || id)
      .filter(Boolean);
    if (labels.length <= 2) return labels.join(", ");
    return `${selectedAccounts.length} accounts selected`;
  }, [selectedAccounts, accounts]);

  const selectedAssetExists = useMemo(
    () => Boolean(selectedAssetId) && assets.some((asset) => asset.id === selectedAssetId),
    [assets, selectedAssetId]
  );
  const selectedAccountsValid = useMemo(
    () => selectedAccounts.every((id) => accounts.some((acc) => acc.id === id)),
    [accounts, selectedAccounts]
  );
  const hasScheduleError = mode === "scheduled" && (!scheduledFor || scheduledFor.getTime() <= Date.now());
  const canSubmit =
    selectedAssetExists &&
    selectedAccounts.length > 0 &&
    selectedAccountsValid &&
    !hasScheduleError &&
    !loading &&
    !immediateLoading;

  const parseApiError = (e: unknown, fallback: string) => formatContentApiError(e, fallback);

  const effectiveContentTypeForCopy: ContentType = useMemo(
    () => (!reelEnabled && contentType === "reel" ? "post" : contentType),
    [reelEnabled, contentType]
  );

  const onGenerateCaption = async () => {
    const nicheKey = (publishNiche || "").trim() || "lifestyle";
    setCaptionGenLoading(true);
    setError(null);
    try {
      const { caption: generated, hashtags } = await api.content.generateCaption({
        niche: nicheKey,
        topic: (publishTopic || "").trim() || undefined,
        content_type: effectiveContentTypeForCopy,
      });
      setCaption(generated);
      setHashtagsInput(hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean).join(", "));
      toast.success("Caption and hashtags generated");
    } catch (e: unknown) {
      const message = parseApiError(e, "Could not generate caption.");
      setError(message);
      toast.error(message);
    } finally {
      setCaptionGenLoading(false);
    }
  };

  /**
   * Stable idempotency: same job + asset + type + accounts + caption + hashtags (+ schedule slot)
   * must map to ONE publication_intent. Avoids duplicate Instagram posts when double-clicking or
   * mixing "Create Publish Intent" with "Post to Instagram Now" for the same payload.
   */
  const buildPublishIdempotencyKey = (payloadMode: PublishMode) => {
    const finalContentType: ContentType = !reelEnabled && contentType === "reel" ? "post" : contentType;
    const accountKey = [...selectedAccounts].sort().join(",");
    const captionKey = caption.trim();
    const hashtagsKey = parseHashtags(hashtagsInput).join(",");
    const base = `studio-${jobId}-${selectedAssetId}-${finalContentType}-${accountKey}-${captionKey}-${hashtagsKey}`;
    if (payloadMode === "scheduled" && scheduledFor) {
      return `${base}-sched-${scheduledFor.getTime()}`;
    }
    if (payloadMode === "save_for_later") {
      return `${base}-draft`;
    }
    return `${base}-now`;
  };

  const buildIntentPayload = (payloadMode: PublishMode) => {
    const payloadModeResolved: PublishMode =
      payloadMode === "scheduled" && !scheduledFor ? "publish_now" : payloadMode;
    const finalContentType: ContentType = !reelEnabled && contentType === "reel" ? "post" : contentType;
    return {
      asset_id: selectedAssetId,
      content_type: finalContentType,
      caption: caption.trim(),
      hashtags: parseHashtags(hashtagsInput),
      mode: payloadModeResolved,
      scheduled_for:
        payloadModeResolved === "scheduled" && scheduledFor ? scheduledFor.toISOString() : undefined,
      target_account_ids: selectedAccounts,
      idempotency_key: buildPublishIdempotencyKey(payloadModeResolved),
    };
  };

  const onCreateIntent = async () => {
    if (!canSubmit) return;
    if (hasScheduleError) {
      const message = "Scheduled publish requires a future date/time.";
      setError(message);
      toast.error(message);
      return;
    }
    setLoading(true);
    setError(null);
    setSuccessResponse(null);
    try {
      const payloadMode: PublishMode = mode === "scheduled" && !scheduledFor ? "publish_now" : mode;
      const response = await api.generationJobs.createPublishIntent(jobId, buildIntentPayload(payloadMode));
      setSuccessResponse(response);
      toast.success("Publish intent created");
    } catch (e: unknown) {
      const message = parseApiError(e, "Could not create publish intent.");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onPostNow = async () => {
    if (!canSubmit || postNowInFlightRef.current) return;
    if (hasScheduleError) {
      const message = "Scheduled publish requires a future date/time.";
      setError(message);
      toast.error(message);
      return;
    }
    postNowInFlightRef.current = true;
    setImmediateLoading(true);
    setError(null);
    setSuccessResponse(null);
    try {
      const intent = await api.generationJobs.createPublishIntent(jobId, buildIntentPayload("publish_now"));
      setSuccessResponse(intent);
      const dispatched = await api.generationJobs.dispatchPublishIntent(intent.intent_id);
      toast.success(`Posting started: ${dispatched.dispatched_targets} target(s) dispatched.`);
    } catch (e: unknown) {
      const message = parseApiError(e, "Could not post now.");
      setError(message);
      toast.error(message);
    } finally {
      setImmediateLoading(false);
      postNowInFlightRef.current = false;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Publish</CardTitle>
        <CardDescription>
          One intent per unique asset + caption + accounts (double-clicks won’t create duplicates).
          Use either create intent or post now — they share the same idempotency for “publish now”.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label>Asset</Label>
          {assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No generated assets found for this job.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {assets.map((asset) => {
                const selected = selectedAssetId === asset.id;
                const isVideo = asset.asset_type === "video" || asset.mime_type.startsWith("video/");
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={cn(
                      "overflow-hidden rounded-md border text-left transition",
                      selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/50"
                    )}
                  >
                    <div className="aspect-video bg-black/60">
                      {isVideo ? (
                        <video src={asset.public_url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.public_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="flex items-center justify-between px-2 py-1 text-xs">
                      <span>{asset.asset_type}</span>
                      <span className="font-mono">{asset.id.slice(0, 8)}…</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Content type</Label>
            <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="post">Post</SelectItem>
                <SelectItem value="story">Story</SelectItem>
                <SelectItem value="reel" disabled={!reelEnabled}>
                  Reel {!reelEnabled ? "(disabled)" : ""}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Target accounts</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate text-left">{accountSummary}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                <DropdownMenuLabel>Select one or more accounts</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {accounts.length === 0 ? (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">No accounts found</div>
                ) : (
                  accounts.map((account) => (
                    <DropdownMenuCheckboxItem
                      key={account.id}
                      checked={selectedAccounts.includes(account.id)}
                      onCheckedChange={(checked) => {
                        setSelectedAccounts((prev) =>
                          checked
                            ? Array.from(new Set([...prev, account.id]))
                            : prev.filter((acc) => acc !== account.id)
                        );
                      }}
                      onSelect={(event) => event.preventDefault()}
                    >
                      @{account.username}
                    </DropdownMenuCheckboxItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label className="mb-0">Caption</Label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              disabled={captionGenLoading}
              onClick={() => void onGenerateCaption()}
            >
              {captionGenLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Generate caption & hashtags
            </Button>
          </div>
          <textarea
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Write your caption or use Generate…"
          />
        </div>

        <div className="space-y-2">
          <Label>Hashtags (comma-separated)</Label>
          <Input
            value={hashtagsInput}
            onChange={(e) => setHashtagsInput(e.target.value)}
            placeholder="fitness, motivation, routine"
          />
        </div>

        <div className="space-y-3">
          <Label>Mode</Label>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === "publish_now"} onChange={() => setMode("publish_now")} />
              Publish now
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === "save_for_later"} onChange={() => setMode("save_for_later")} />
              Save for later
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === "scheduled"} onChange={() => setMode("scheduled")} />
              Schedule
            </label>
          </div>
          {mode === "scheduled" ? (
            <div className="max-w-sm">
              <DateTimePicker value={scheduledFor} onChange={setScheduledFor} placeholder="Pick date & time" />
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" disabled={!canSubmit} onClick={onCreateIntent}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create Publish Intent
          </Button>
          <Button type="button" disabled={!canSubmit} onClick={onPostNow}>
            {immediateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Post to Instagram Now
          </Button>
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {successResponse ? (
          <div className="rounded-md border border-emerald-300/50 bg-emerald-50/40 p-3 text-sm dark:border-emerald-700/60 dark:bg-emerald-900/10">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">Publish intent created</p>
            <p className="mt-1">
              <span className="font-semibold">intent_id:</span> <span className="font-mono">{successResponse.intent_id}</span>
            </p>
            <p>
              <span className="font-semibold">status:</span> {successResponse.status}
            </p>
            <div className="mt-2 space-y-1">
              {successResponse.targets.map((t) => (
                <p key={`${t.account_id}-${t.platform}`} className="text-xs">
                  {t.account_id} · {t.platform} · {t.status}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GenerationStudioPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [contentType, setContentType] = useState<ContentType>("reel");
  const [mode, setMode] = useState<Mode>("faceless");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("multi_scene_single_video");
  /** AliveAI blocking image / persona LLM gender (API: MALE | FEMALE | TRANS). */
  const [ailiveaiGender, setAiliveaiGender] = useState<AiliveaiGender>("FEMALE");
  const [videoDuration, setVideoDuration] = useState<number>(15);
  const [niche, setNiche] = useState<string>("fitness");
  const [topic, setTopic] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<Date | undefined>(undefined);
  const [draftScenes, setDraftScenes] = useState<DraftScene[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelStepLoading, setCancelStepLoading] = useState<string | null>(null);
  const [previewingTarget, setPreviewingTarget] = useState<{ sceneId: string; kind: "image" | "video" } | null>(null);
  /** At most one scene video panel expanded (toggle with "Vid preview" / "Hide video"). */
  const [openSceneVideoId, setOpenSceneVideoId] = useState<string | null>(null);
  /** Per-scene: image preview strip folded (hidden); prompt and video stay visible. */
  const [sceneImagePreviewFolded, setSceneImagePreviewFolded] = useState<Record<string, boolean>>({});
  /** Fullscreen image lightbox (scene image preview). */
  const [imageLightboxSrc, setImageLightboxSrc] = useState<string | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editScene, setEditScene] = useState<JobScene | DraftScene | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editDuration, setEditDuration] = useState(4);
  const [editRole, setEditRole] = useState<string>("motion");

  const [dragSceneId, setDragSceneId] = useState<string | null>(null);

  useEffect(() => {
    const q = searchParams.get("job");
    if (q && /^[0-9a-f-]{36}$/i.test(q.trim())) {
      setJobId(q.trim());
    }
  }, [searchParams]);

  useEffect(() => {
    if (executionMode === "ailiveai_single_video") {
      setMode("persona");
      setVideoDuration((d) => (d === 5 ? 5 : 10));
    }
  }, [executionMode]);

  const fetchJob = useCallback(async (id: string) => {
    return api.generationJobs.get(id) as Promise<GenerationJobDetail>;
  }, []);

  const {
    data: job,
    mutate,
    isLoading: jobLoading,
    error: jobError,
  } = useSWR<GenerationJobDetail | undefined>(
    jobId ? ["generation-job", jobId] : null,
    () => fetchJob(jobId as string),
    { refreshInterval: jobId ? 2000 : 0 }
  );

  const { data: accountChoices = [], isLoading: accountsLoading } = useSWR<Array<{ id: string; username: string }>>(
    "distribution-accounts",
    async () => {
      const list = (await api.distribution.getAccounts()) as DistributionAccount[];
      return list
        .map((acc) => ({
          id: typeof acc?.id === "string" ? acc.id.trim() : "",
          username: typeof acc?.username === "string" ? acc.username.trim() : "",
        }))
        .filter((acc) => Boolean(acc.id) && Boolean(acc.username));
    }
  );
  const { data: generatedAssets = [], isLoading: assetsLoading } = useSWR<GeneratedAsset[]>(
    jobId && job?.status === "completed" ? ["generation-job-assets", jobId] : null,
    () => api.generationJobs.getJobAssets(jobId as string),
    { refreshInterval: 0 }
  );

  const finalPlayableUrl = useMemo(() => {
    if (!job || job.status !== "completed") return null;
    if (job.output_url) return job.output_url;
    const v = generatedAssets.find((a) => a.asset_type === "video");
    return v?.public_url ?? null;
  }, [job, generatedAssets]);

  useEffect(() => {
    setOpenSceneVideoId(null);
  }, [jobId]);

  useEffect(() => {
    const raw = job?.input_payload?.ailiveai_gender;
    const g = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (g === "FEMALE" || g === "MALE" || g === "TRANS") {
      setAiliveaiGender(g as AiliveaiGender);
    }
  }, [job?.id, job?.input_payload?.ailiveai_gender]);

  const sortedScenes: Array<JobScene | DraftScene> = useMemo(() => {
    if (job?.scenes?.length) {
      return [...job.scenes].sort((a, b) => a.scene_index - b.scene_index);
    }
    return [...draftScenes].sort((a, b) => a.scene_index - b.scene_index);
  }, [job, draftScenes]);

  const totalDurationSec = useMemo(
    () => sortedScenes.reduce((acc, s) => acc + (s.duration || 0), 0),
    [sortedScenes]
  );
  const accountSummary = useMemo(() => {
    if (selectedAccounts.length === 0) return "Select target accounts";
    const labels = selectedAccounts
      .map((id) => accountChoices.find((a) => a.id === id)?.username || id)
      .filter(Boolean);
    if (labels.length <= 2) return labels.join(", ");
    return `${selectedAccounts.length} accounts selected`;
  }, [selectedAccounts, accountChoices]);

  const canLaunch = job && (job.status === "draft" || job.status === "ready");
  const jobIsCancelling = job?.status === "cancelling";
  const jobIsCancelled = job?.status === "cancelled";
  const canStopPipeline = job && (job.status === "running" || job.status === "pending");
  const sceneActionsLocked = Boolean(jobIsCancelling);
  const sceneRegenDisabled = Boolean(jobIsCancelling || jobIsCancelled);
  const livePollActive = job && ["running", "pending", "cancelling"].includes(job.status);
  const isVerticalVideo = contentType === "reel" || contentType === "story";

  const handlePreview = async () => {
    if (!topic.trim()) {
      toast.error("Add a topic for the run.");
      return;
    }
    setPreviewLoading(true);
    try {
      const plan = await api.generationJobs.previewScenes({
        content_type: contentType,
        mode: executionMode === "ailiveai_single_video" ? "persona" : mode,
        niche,
        topic: topic.trim(),
        execution_mode: executionMode,
      });
      setDraftScenes(plan);
      setJobId(null);
      router.replace("/generation-studio", { scroll: false });
      toast.success("Scene preview ready (not saved as a job).");
    } catch {
      toast.error("Preview failed. Check Content API and Claude configuration.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!topic.trim() || selectedAccounts.length === 0) {
      toast.error("Topic and at least one account are required.");
      return;
    }
    setCreateLoading(true);
    try {
      const res = await api.generationJobs.create({
        execution_mode: executionMode,
        content_type: contentType,
        mode,
        niche,
        topic: topic.trim(),
        target_accounts: selectedAccounts,
        scheduled_at: schedule ? schedule.toISOString() : undefined,
        video_duration:
          executionMode === "multi_scene_single_video" || executionMode === "ailiveai_single_video"
            ? videoDuration
            : undefined,
        ...(executionMode === "ailiveai_single_video" ? { ailiveai_gender: ailiveaiGender } : {}),
      });
      setJobId(res.job_id);
      addTrackedGenerationJobId(res.job_id);
      router.replace(`/generation-studio?job=${encodeURIComponent(res.job_id)}`, { scroll: false });
      toast.success("Draft job created with scenes. Edit, preview, then launch.");
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      const code =
        e && typeof e === "object" && "code" in e ? String((e as { code?: string }).code || "") : "";
      if (code === "ECONNABORTED") {
        toast.error("Create draft request timed out on frontend. Retrying usually succeeds.");
      } else {
        toast.error(typeof msg === "string" ? msg : "Could not create draft job.");
      }
    } finally {
      setCreateLoading(false);
    }
  };

  const handleLaunchPipeline = async () => {
    if (!jobId) return;
    setLaunchLoading(true);
    try {
      await api.generationJobs.launch(jobId);
      addTrackedGenerationJobId(jobId);
      await mutate();
      toast.success("Pipeline started.");
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "response" in e ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : "Launch failed.");
    } finally {
      setLaunchLoading(false);
    }
  };

  const handleStopPipeline = async () => {
    if (!jobId) return;
    setCancelLoading(true);
    try {
      await api.generationJobs.cancel(jobId);
      await mutate();
      toast.success("Stopping… partial results are kept.");
    } catch (e: unknown) {
      const msg = e && typeof e === "object" && "response" in e ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail : null;
      toast.error(typeof msg === "string" ? msg : "Could not request stop.");
    } finally {
      setCancelLoading(false);
    }
  };

  const handleMarkReady = async () => {
    if (!jobId) return;
    setReadyLoading(true);
    try {
      await api.generationJobs.markReady(jobId);
      await mutate();
      toast.success("Marked ready.");
    } catch {
      toast.error("Could not mark ready.");
    } finally {
      setReadyLoading(false);
    }
  };

  const handleSceneMediaPreview = async (sceneId: string, kind: "image" | "video") => {
    if (!jobId) return;
    setPreviewingTarget({ sceneId, kind });
    try {
      await api.generationJobs.previewScene(jobId, sceneId, kind);
      await mutate();
      toast.success(kind === "video" ? "Video preview generated." : "Image preview generated.");
      if (kind === "video") {
        setOpenSceneVideoId(sceneId);
      }
    } catch {
      toast.error("Preview generation failed.");
    } finally {
      setPreviewingTarget(null);
    }
  };

  const reorderLocalDraft = (fromId: string, toId: string) => {
    if (!fromId.startsWith("draft-") || !toId.startsWith("draft-")) return;
    const fromIdx = Number(fromId.replace("draft-", ""));
    const toIdx = Number(toId.replace("draft-", ""));
    const arr = [...draftScenes].sort((a, b) => a.scene_index - b.scene_index);
    const fi = arr.findIndex((s) => s.scene_index === fromIdx);
    const ti = arr.findIndex((s) => s.scene_index === toIdx);
    if (fi < 0 || ti < 0) return;
    const [moved] = arr.splice(fi, 1);
    arr.splice(ti, 0, moved);
    setDraftScenes(arr.map((s, i) => ({ ...s, scene_index: i })));
  };

  const reorderServerScenes = async (fromSceneId: string, toSceneId: string) => {
    if (!jobId || !job?.scenes) return;
    const ordered = [...job.scenes].sort((a, b) => a.scene_index - b.scene_index);
    const ids = ordered.map((s) => s.id);
    const fi = ids.indexOf(fromSceneId);
    const ti = ids.indexOf(toSceneId);
    if (fi < 0 || ti < 0) return;
    const next = [...ids];
    const [m] = next.splice(fi, 1);
    next.splice(ti, 0, m);
    try {
      await api.generationJobs.reorderScenes(jobId, next);
      await mutate();
    } catch {
      toast.error("Reorder failed.");
    }
  };

  const onDropOnScene = (targetKey: string) => {
    if (!dragSceneId || dragSceneId === targetKey) {
      setDragSceneId(null);
      return;
    }
    if (dragSceneId.startsWith("draft-") && targetKey.startsWith("draft-")) {
      reorderLocalDraft(dragSceneId, targetKey);
      setDragSceneId(null);
      return;
    }
    if (jobId && job?.scenes?.[0]?.id && !dragSceneId.startsWith("draft-") && !targetKey.startsWith("draft-")) {
      reorderServerScenes(dragSceneId, targetKey);
    }
    setDragSceneId(null);
  };

  const openEdit = (scene: JobScene | DraftScene) => {
    setEditScene(scene);
    setEditPrompt(scene.prompt);
    setEditDuration(scene.duration);
    const r = "scene_role" in scene && scene.scene_role ? scene.scene_role : "role" in scene && scene.role ? scene.role : "motion";
    setEditRole(r || "motion");
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editScene) return;
    const isServer = "id" in editScene && !!editScene.id;
    if (isServer && jobId) {
      try {
        await api.generationJobs.patchScene(jobId, (editScene as JobScene).id, {
          prompt: editPrompt,
          duration: editDuration,
          scene_role: editRole,
        });
        await mutate();
        toast.success("Scene updated.");
      } catch {
        toast.error("Update failed.");
        return;
      }
    } else {
      setDraftScenes((prev) =>
        prev.map((s) =>
          s.scene_index === (editScene as DraftScene).scene_index
            ? { ...s, prompt: editPrompt, duration: editDuration, role: editRole }
            : s
        )
      );
      toast.success("Draft scene updated.");
    }
    setEditOpen(false);
  };

  const regenerateScene = async (scene: JobScene | DraftScene) => {
    const isServer = "id" in scene && !!(scene as JobScene).id;
    if (isServer && jobId) {
      if (job?.status === "draft" || job?.status === "ready") {
        toast.error("Launch the job before full scene media retry.");
        return;
      }
      try {
        await api.generationJobs.retryScene(jobId, (scene as JobScene).id);
        await mutate();
        toast.success("Scene regeneration scheduled.");
      } catch {
        toast.error("Retry failed.");
      }
      return;
    }
    await handlePreview();
  };

  const retryStep = async (stepName: string) => {
    if (!jobId) return;
    try {
      await api.generationJobs.retryStep(jobId, stepName);
      await mutate();
      toast.success(`Retry scheduled for ${stepName}.`);
    } catch {
      toast.error("Retry step failed.");
    }
  };

  const cancelStep = async (stepName: string) => {
    if (!jobId) return;
    setCancelStepLoading(stepName);
    try {
      await api.generationJobs.cancelStep(jobId, stepName);
      await mutate();
      toast.success(`Stopping ${stepName}…`);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? (e as { response?: { data?: { detail?: string } } }).response?.data?.detail
          : null;
      toast.error(typeof msg === "string" ? msg : "Cancel step failed.");
    } finally {
      setCancelStepLoading(null);
    }
  };

  const pipelineStepControl = (stepName: string, stepStatus: string) => {
    const c = job?.step_control?.[stepName];
    if (c) return c;
    if (stepStatus === "completed") return "completed";
    if (stepStatus === "cancelled") return "cancelled";
    return "pending";
  };

  const logs = job?.logs ?? [];
  const maxDur = Math.max(1, ...sortedScenes.map((s) => s.duration || 1));

  const topicPlaceholder = useMemo(() => {
    const key = NICHE_OPTIONS.includes(niche as (typeof NICHE_OPTIONS)[number])
      ? (niche as (typeof NICHE_OPTIONS)[number])
      : "lifestyle";
    return TOPIC_PLACEHOLDER_BY_NICHE[key];
  }, [niche]);

  const topicSuggestion = useMemo(
    () => topicPlaceholder.replace(/^e\.g\.\s*/i, "").trim(),
    [topicPlaceholder]
  );

  return (
    <div className="flex-1 min-h-screen bg-neutral-50 p-6 dark:bg-neutral-950">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            Generation Studio
          </h1>
          <p className="text-sm text-muted-foreground">
            Draft-first workflow: scenes and copy are created up front; launch only when you are ready to spend compute.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Controls</CardTitle>
              <CardDescription>Create a persisted draft job, edit scenes, then launch.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Content type</Label>
                <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="post">Post</SelectItem>
                    <SelectItem value="reel">Reel</SelectItem>
                    <SelectItem value="story">Story</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="persona">Persona</SelectItem>
                    <SelectItem value="faceless">Faceless</SelectItem>
                  </SelectContent>
                </Select>
              </div>
                <div className="space-y-2">
                  <Label>Execution Mode</Label>
                  <Select value={executionMode} onValueChange={(v) => setExecutionMode(v as ExecutionMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multi_scene_single_video">Multi-scene single video (Seedance)</SelectItem>
                      <SelectItem value="ailiveai_single_video">Single video (AILIVEAI)</SelectItem>
                      <SelectItem value="scene_based">Scene-based (Kie)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              <div className="space-y-2">
                <Label>Niche</Label>
                <Select value={niche} onValueChange={setNiche}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NICHE_OPTIONS.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {executionMode === "multi_scene_single_video" || executionMode === "ailiveai_single_video" ? (
                <div className="space-y-2">
                  <Label>Video duration (single clip)</Label>
                  <Select
                    value={String(videoDuration)}
                    onValueChange={(v) => setVideoDuration(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {executionMode === "ailiveai_single_video" ? (
                        <>
                          <SelectItem value="5">~5s (AliveAI SHORT)</SelectItem>
                          <SelectItem value="10">~10s (AliveAI MEDIUM)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="4">4s</SelectItem>
                          <SelectItem value="5">5s</SelectItem>
                          <SelectItem value="6">6s</SelectItem>
                          <SelectItem value="7">7s</SelectItem>
                          <SelectItem value="8">8s</SelectItem>
                          <SelectItem value="9">9s</SelectItem>
                          <SelectItem value="10">10s</SelectItem>
                          <SelectItem value="11">11s</SelectItem>
                          <SelectItem value="12">12s</SelectItem>
                          <SelectItem value="13">13s</SelectItem>
                          <SelectItem value="14">14s</SelectItem>
                          <SelectItem value="15">15s</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {executionMode === "ailiveai_single_video"
                      ? "AliveAI: a blocking persona image is generated first, then image-to-video (always persona mode)."
                      : "Seedance supports 4 to 15 seconds."}
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Persona gender (AliveAI)</Label>
                <Select
                  value={ailiveaiGender}
                  onValueChange={(v) => setAiliveaiGender(v as AiliveaiGender)}
                  disabled={executionMode !== "ailiveai_single_video"}
                >
                  <SelectTrigger className={executionMode !== "ailiveai_single_video" ? "opacity-80" : undefined}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="TRANS">Trans</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {executionMode === "ailiveai_single_video" ? (
                    <>
                      Sent as AliveAI <span className="font-mono text-[11px]">gender</span> for the blocking portrait and
                      used to steer the generated persona text.
                    </>
                  ) : (
                    <>
                      Choose <strong>Single video (AILIVEAI)</strong> in Execution mode above to enable this. It is not
                      used for Seedance or scene-based Kie jobs.
                    </>
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Topic</Label>
                <div className="relative flex items-center">
                  <Input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder={topicPlaceholder}
                    className="pr-10"
                    aria-describedby="topic-suggestion-hint"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0.5 top-1/2 h-8 w-8 shrink-0 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    title={`Use suggestion: ${topicSuggestion}`}
                    aria-label="Fill topic with placeholder suggestion"
                    onClick={() => setTopic(topicSuggestion)}
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </div>
                <p id="topic-suggestion-hint" className="sr-only">
                  Sparkles button inserts the example topic for the selected niche.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Accounts</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between font-normal">
                      <span className="truncate text-left">{accountSummary}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuLabel>Select one or more accounts</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {accountsLoading ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">Loading accounts...</div>
                    ) : accountChoices.length === 0 ? (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">No accounts found</div>
                    ) : (
                      accountChoices.map((account) => (
                        <DropdownMenuCheckboxItem
                          key={account.id}
                          checked={selectedAccounts.includes(account.id)}
                          onCheckedChange={(checked) => {
                            setSelectedAccounts((prev) =>
                              checked
                                ? Array.from(new Set([...prev, account.id]))
                                : prev.filter((acc) => acc !== account.id)
                            );
                          }}
                          onSelect={(event) => event.preventDefault()}
                        >
                          @{account.username}
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-2">
                <Label>Schedule</Label>
                <DateTimePicker
                  value={schedule}
                  onChange={setSchedule}
                  placeholder="Pick date & time"
                />
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Button type="button" variant="secondary" disabled={previewLoading} onClick={handlePreview}>
                  {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Preview scenes (no job)
                </Button>
                <Button type="button" disabled={createLoading} onClick={handleCreateDraft}>
                  {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  Create draft job
                </Button>
                {jobId && canLaunch ? (
                  <>
                    <Button type="button" variant="secondary" disabled={readyLoading} onClick={handleMarkReady}>
                      {readyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Mark ready
                    </Button>
                    <Button type="button" disabled={launchLoading} onClick={handleLaunchPipeline}>
                      {launchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                      Launch pipeline
                    </Button>
                  </>
                ) : null}
              </div>
              {jobId && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Job <span className="font-mono">{jobId.slice(0, 8)}…</span>
                    {job ? ` · ${job.status}` : ""}
                  </p>
                  {canStopPipeline ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 dark:border-destructive/60"
                      disabled={cancelLoading}
                      onClick={handleStopPipeline}
                    >
                      {cancelLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                      Cancel job
                    </Button>
                  ) : null}
                  {jobIsCancelling ? (
                    <p className="text-xs text-muted-foreground">Stopping… the pipeline will exit after the current step.</p>
                  ) : null}
                </div>
              )}
              {job?.cost_estimate ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  {(() => {
                    const ce = job.cost_estimate;
                    if (!ce) return null;
                    return (
                      <>
                        <p className="font-semibold text-foreground">Cost estimate (credits)</p>
                        {ce.model ? (
                          <p className="mt-1 text-muted-foreground">
                            {ce.model}
                            {ce.provider ? ` · ${ce.provider}` : ""}
                          </p>
                        ) : null}
                        <p className="mt-1 text-lg font-bold">{ce.total_credits}</p>
                        <ul className="mt-2 space-y-1 text-muted-foreground">
                          {ce.breakdown.map((b) => (
                            <li key={b.line}>
                              {ce.model
                                ? `${b.line}: ${b.units}s × ${b.unit_credits} credits/s = ${b.subtotal}`
                                : `${b.line}: ${b.units} × ${b.unit_credits} = ${b.subtotal}`}
                            </li>
                          ))}
                        </ul>
                        {ce.estimate_note ? (
                          <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
                            {ce.estimate_note}
                          </p>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-base">Timeline</CardTitle>
              <CardDescription>
                Total storyboard length: <strong>{totalDurationSec}s</strong>. Drag blocks to reorder (draft preview uses
                local order; saved jobs call the API).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobId && jobLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Loading job scenes…
                </div>
              ) : sortedScenes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Create a draft job or run a stateless preview.</p>
              ) : (
                <>
                  <div className="flex h-24 w-full gap-1 rounded-lg border border-border bg-muted/20 p-2">
                    {sortedScenes.map((scene) => {
                      const w = Math.max(8, ((scene.duration || 3) / maxDur) * 100);
                      const sid = "id" in scene && scene.id ? scene.id : `draft-${scene.scene_index}`;
                      return (
                        <div
                          key={sid}
                          draggable={!jobIsCancelling}
                          onDragStart={() => !jobIsCancelling && setDragSceneId(sid)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => onDropOnScene(sid)}
                          style={{ flex: `${w} 1 0` }}
                          className="relative flex min-w-[3rem] flex-col overflow-hidden rounded-md border border-border bg-card shadow-sm"
                        >
                          <div className="flex items-center justify-between gap-0.5 bg-muted/80 px-1 py-0.5">
                            <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate text-[10px] font-semibold">#{scene.scene_index}</span>
                          </div>
                          <div
                            className="flex min-h-[2.5rem] flex-1 items-center justify-center bg-muted/25 px-1"
                            title="Preview appears under the scene text below"
                          >
                            <span className="text-center text-[9px] leading-tight text-muted-foreground">
                              {scene.duration}s
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
                    {sortedScenes.map((scene) => {
                      const sid = "id" in scene && scene.id ? scene.id : undefined;
                      const key = sid ?? `draft-${scene.scene_index}`;
                      const st = "status" in scene && scene.status ? scene.status : "local";
                      const meta = "metadata" in scene ? scene.metadata : undefined;
                      const jobScene = sid ? (scene as JobScene) : null;
                      const videoSrc =
                        meta?.preview_video_url ??
                        (jobScene?.video_url ? String(jobScene.video_url) : undefined);
                      const videoPanelOpen = Boolean(sid && openSceneVideoId === sid && videoSrc);
                      const imgPreviewBusy =
                        Boolean(sid && previewingTarget?.sceneId === sid && previewingTarget.kind === "image");
                      const vidPreviewBusy =
                        Boolean(sid && previewingTarget?.sceneId === sid && previewingTarget.kind === "video");
                      const imagePreviewSrc =
                        meta?.preview_image_url ??
                        (jobScene?.start_image_url ? String(jobScene.start_image_url) : undefined);
                      const imageFolded = sceneImagePreviewFolded[key] === true;
                      return (
                        <div key={key} className="rounded-lg border border-border bg-card/60 p-3 shadow-sm">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-muted-foreground">Scene {scene.scene_index}</span>
                              {"scene_role" in scene && scene.scene_role ? (
                                <Badge variant="outline">{scene.scene_role}</Badge>
                              ) : "role" in scene && scene.role ? (
                                <Badge variant="outline">{scene.role}</Badge>
                              ) : null}
                              <Badge variant={statusBadgeVariant(st)}>{st}</Badge>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {sid && jobId ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={sceneActionsLocked || sceneRegenDisabled || imgPreviewBusy}
                                    onClick={() => handleSceneMediaPreview(sid, "image")}
                                  >
                                    {imgPreviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                    Img preview
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={sceneActionsLocked || sceneRegenDisabled || vidPreviewBusy}
                                    onClick={() => {
                                      if (!videoSrc) {
                                        void handleSceneMediaPreview(sid, "video");
                                        return;
                                      }
                                      setOpenSceneVideoId((prev) => (prev === sid ? null : sid));
                                    }}
                                  >
                                    {vidPreviewBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                    {videoPanelOpen ? "Hide video" : "Vid preview"}
                                  </Button>
                                </>
                              ) : null}
                              <Button size="sm" variant="outline" disabled={sceneActionsLocked} onClick={() => openEdit(scene)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={sceneActionsLocked || sceneRegenDisabled}
                                onClick={() => regenerateScene(scene)}
                              >
                                Retry media
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <p className="text-sm leading-relaxed">{scene.prompt}</p>
                            {imagePreviewSrc ? (
                              <div
                                className={cn(
                                  "relative overflow-hidden rounded-lg border border-border/50 bg-muted/20 ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
                                  isVerticalVideo ? "max-w-[min(100%,240px)]" : "max-w-md"
                                )}
                              >
                                <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border border-border/60 bg-background/90 p-0.5 shadow-sm backdrop-blur-sm">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    aria-label="View image fullscreen"
                                    onClick={() => setImageLightboxSrc(imagePreviewSrc)}
                                  >
                                    <Maximize2 className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    aria-expanded={!imageFolded}
                                    aria-label={imageFolded ? "Show image preview" : "Hide image preview"}
                                    onClick={() =>
                                      setSceneImagePreviewFolded((prev) => ({
                                        ...prev,
                                        [key]: !(prev[key] === true),
                                      }))
                                    }
                                  >
                                    {imageFolded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronUp className="h-4 w-4" />
                                    )}
                                  </Button>
                                </div>
                                {!imageFolded ? (
                                  <button
                                    type="button"
                                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    onClick={() => setImageLightboxSrc(imagePreviewSrc)}
                                    aria-label="Open image preview fullscreen"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      alt=""
                                      src={imagePreviewSrc}
                                      className={cn(
                                        "h-auto w-full object-cover",
                                        isVerticalVideo ? "aspect-[9/16] max-h-[360px]" : "aspect-video max-h-[280px]"
                                      )}
                                    />
                                  </button>
                                ) : (
                                  <div className="flex min-h-[3.5rem] items-center bg-muted/30 pl-3 pr-[4.5rem]">
                                    <span className="text-xs text-muted-foreground">Image preview hidden</span>
                                  </div>
                                )}
                              </div>
                            ) : null}
                            {videoSrc ? (
                              <div
                                className={cn(
                                  "video-container overflow-hidden rounded-lg border border-border/50 bg-muted/20 shadow-md shadow-black/[0.07] ring-1 ring-black/[0.04] transition-[max-height,opacity] duration-300 ease-in-out dark:bg-muted/10 dark:shadow-black/40 dark:ring-white/[0.06]",
                                  videoPanelOpen ? "max-h-[560px] opacity-100" : "max-h-0 opacity-0"
                                )}
                                aria-hidden={!videoPanelOpen}
                              >
                                <div
                                  className={cn(
                                    "p-2 transition-opacity duration-300 ease-in-out",
                                    videoPanelOpen ? "opacity-100" : "pointer-events-none opacity-0"
                                  )}
                                >
                                  <video
                                    src={videoSrc}
                                    className={cn(
                                      "mx-auto w-full max-h-[320px] rounded-lg object-cover shadow-sm",
                                      isVerticalVideo
                                        ? "aspect-[9/16] max-w-[min(100%,280px)]"
                                        : "aspect-video max-w-full"
                                    )}
                                    controls
                                    playsInline
                                    preload="metadata"
                                  />
                                </div>
                              </div>
                            ) : null}
                          </div>
                          {sid && (scene as JobScene).error_message ? (
                            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{(scene as JobScene).error_message}</p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Live job</CardTitle>
              <CardDescription>
                {livePollActive || (job && job.status === "completed")
                  ? jobIsCancelling
                    ? "Stopping… polling every 2s."
                    : "Polling every 2–3s while the job is active."
                  : "Polling while a job id is set."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!jobId ? (
                <p className="text-sm text-muted-foreground">Create a draft job to inspect status, cost, and steps.</p>
              ) : jobLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Loading job status…
                </div>
              ) : jobError ? (
                <p className="text-sm text-destructive">Could not load this job. Check the ID or try again.</p>
              ) : !job ? (
                <p className="text-sm text-muted-foreground">No job data returned.</p>
              ) : job.status === "draft" || job.status === "ready" ? (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <span>
                    This job is in <Badge variant="outline">{job.status}</Badge> — no media pipeline is running. Use{" "}
                    <strong>Launch pipeline</strong> when edits are final.
                  </span>
                  <Progress value={job.progress} className="h-2" />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span>Progress</span>
                      <span className="font-mono">{job.progress}%</span>
                    </div>
                    <Progress value={job.progress} className="h-2" />
                    <div className="flex w-full flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
                        {jobIsCancelling ? (
                          <span className="text-xs text-muted-foreground">Stopping…</span>
                        ) : null}
                      </div>
                      {canStopPipeline ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={cancelLoading}
                          onClick={handleStopPipeline}
                          className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10 dark:border-destructive/60"
                        >
                          {cancelLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                          Cancel job
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {finalPlayableUrl ? (
                    <div className="overflow-hidden rounded-md border bg-black">
                      <video
                        key={finalPlayableUrl}
                        src={finalPlayableUrl}
                        className="aspect-[9/16] max-h-[320px] w-full object-contain"
                        controls
                        playsInline
                      />
                    </div>
                  ) : job.status === "completed" && assetsLoading ? (
                    <div className="flex aspect-video items-center justify-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading final output…
                    </div>
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-md border border-dashed px-3 text-center text-xs text-muted-foreground">
                      {jobIsCancelled
                        ? "Job was cancelled. Partial scene media is preserved; no final assembly was run."
                        : job.status === "completed"
                          ? "No final video URL yet. If assets exist below, use Publish or scene previews."
                          : "Final video appears when assembly completes."}
                    </div>
                  )}

                  <Tabs defaultValue="steps">
                    <TabsList className="w-full">
                      <TabsTrigger className="flex-1" value="steps">
                        Steps
                      </TabsTrigger>
                      <TabsTrigger className="flex-1" value="logs">
                        Logs
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="steps" className="mt-3 space-y-2">
                      {job.steps.map((s) => {
                        const ctrl = pipelineStepControl(s.step_name, s.status);
                        const stepSkipped = stepMetadataSkipped(s.metadata);
                        const skipHint = pipelineStepSkipHint(s.metadata);
                        const videoGenStartedAt =
                          s.step_name === "video_generation"
                            ? formatVideoGenExecutionStart(s.metadata)
                            : null;
                        const showCancel = ctrl !== "completed" && s.status !== "completed";
                        const cancelDisabled =
                          job.status === "draft" ||
                          job.status === "ready" ||
                          jobIsCancelling ||
                          jobIsCancelled ||
                          ctrl === "cancelling" ||
                          ctrl === "cancelled" ||
                          s.status === "cancelled" ||
                          (s.status !== "running" && ctrl !== "running");
                        return (
                          <div
                            key={s.id}
                            className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <div className="flex min-w-0 flex-1 items-start gap-2">
                              <StepIcon status={s.status} skipped={stepSkipped} />
                              <div className="min-w-0">
                                <p className="font-medium leading-none">{s.step_name}</p>
                                {stepSkipped && s.status === "completed" ? (
                                  <p className="text-xs text-muted-foreground">Skipped</p>
                                ) : (
                                  <>
                                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                      <span>{s.progress}%</span>
                                      {videoGenStartedAt ? (
                                        <span>Generation started {videoGenStartedAt}</span>
                                      ) : null}
                                    </p>
                                    {typeof s.metadata?.video_scenes_completed === "number" &&
                                    typeof s.metadata?.video_scenes_total === "number" ? (
                                      <p className="text-xs text-muted-foreground">
                                        Scenes {s.metadata.video_scenes_completed}/
                                        {s.metadata.video_scenes_total}
                                      </p>
                                    ) : null}
                                    {s.status === "running" &&
                                    s.step_name === "video_generation" &&
                                    typeof s.metadata?.phase === "string" ? (
                                      <p className="text-xs text-muted-foreground">
                                        {String(s.metadata.phase).replace(/_/g, " ")}
                                      </p>
                                    ) : null}
                                  </>
                                )}
                                {skipHint ? (
                                  <p className="mt-1 text-xs text-muted-foreground">{skipHint}</p>
                                ) : null}
                                {ctrl === "cancelling" ? (
                                  <p className="mt-1 text-xs text-amber-700">Cancelling…</p>
                                ) : null}
                                {s.status === "failed" && s.error_message ? (
                                  <p className="mt-1 text-xs text-red-600">{s.error_message}</p>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                              {showCancel ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="shrink-0"
                                  disabled={cancelDisabled || cancelStepLoading === s.step_name}
                                  onClick={() => cancelStep(s.step_name)}
                                >
                                  {cancelStepLoading === s.step_name ? (
                                    <span className="inline-flex items-center gap-1">
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                      Cancel
                                    </span>
                                  ) : (
                                    "Cancel"
                                  )}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="secondary"
                                className="shrink-0"
                                disabled={
                                  job.status === "draft" ||
                                  job.status === "ready" ||
                                  jobIsCancelling ||
                                  jobIsCancelled ||
                                  ctrl === "cancelling" ||
                                  ctrl === "cancelled" ||
                                  s.status === "cancelled"
                                }
                                onClick={() => retryStep(s.step_name)}
                              >
                                Retry
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </TabsContent>
                    <TabsContent value="logs" className="mt-3 max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                      {logs.length === 0 ? (
                        <span className="text-muted-foreground">No log lines yet.</span>
                      ) : (
                        logs.map((line, i) => (
                          <div key={`${line.ts}-${i}`} className="whitespace-pre-wrap">
                            <span className="text-muted-foreground">[{line.ts}]</span>{" "}
                            <span
                              className={cn(
                                line.level === "error" && "text-red-600",
                                line.level === "warning" && "text-amber-700"
                              )}
                            >
                              {line.message}
                            </span>
                          </div>
                        ))
                      )}
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </CardContent>
          </Card>
        </div>
        {jobId && job?.status === "completed" ? (
          assetsLoading ? (
            <Card>
              <CardContent className="py-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading generated assets...
                </div>
              </CardContent>
            </Card>
          ) : (
            <PublishPanel
              jobId={jobId}
              assets={generatedAssets}
              accounts={accountChoices}
              publishNiche={String(job?.input_payload?.niche ?? niche ?? "lifestyle")}
              publishTopic={String(job?.input_payload?.topic ?? topic ?? "")}
            />
          )
        ) : null}
      </div>

      <Dialog
        open={imageLightboxSrc !== null}
        onOpenChange={(open) => {
          if (!open) setImageLightboxSrc(null);
        }}
      >
        <DialogContent className="max-h-[95vh] max-w-[min(96vw,1200px)] border-border/40 bg-background p-2 sm:p-4">
          <DialogHeader>
            <DialogTitle className="sr-only">Scene image preview</DialogTitle>
          </DialogHeader>
          {imageLightboxSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageLightboxSrc}
              alt=""
              className="mx-auto max-h-[min(88vh,900px)] w-full max-w-full object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit scene</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Prompt</Label>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Duration (seconds)</Label>
              <Select value={String(editDuration)} onValueChange={(v) => setEditDuration(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="4">4</SelectItem>
                  <SelectItem value="5">5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hook">hook</SelectItem>
                  <SelectItem value="motion">motion</SelectItem>
                  <SelectItem value="detail">detail</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GenerationStudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading studio…
        </div>
      }
    >
      <GenerationStudioPageInner />
    </Suspense>
  );
}
