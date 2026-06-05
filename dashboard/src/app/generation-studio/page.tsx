"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { api, formatContentApiError } from "@/lib/api";
import { summarizeJobPipelineErrors } from "@/lib/generation-errors";
import { SCENE_BASED_EXECUTION_UI_ENABLED } from "@/lib/generation-studio-config";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { GenerationStudioPublishPanel } from "@/components/generation/GenerationStudioPublishPanel";
import { GenerationStudioWorkflowBar } from "@/components/generation/GenerationStudioWorkflowBar";
import { LiveJobProgress } from "@/components/generation/LiveJobProgress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  CircleHelp,
  GripVertical,
  Loader2,
  ListOrdered,
  Lock,
  Maximize2,
  RefreshCw,
  Rocket,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  Video,
  XCircle,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import toast from "react-hot-toast";
import { addTrackedGenerationJobId } from "@/lib/generation-job-tracking";
import { canAbandonGenerationJob } from "@/lib/generation-job-actions";
import { useLocale } from "@/components/i18n/LocaleProvider";
import {
  generationStudioI18n,
  type GenerationStudioI18n,
  type GenerationStudioPipelineLabels,
} from "@/lib/i18n-generation-studio";
import {
  deriveStudioWorkflowPhase,
  isPublicationTabUnlocked,
  parseStudioTab,
  resolveStudioUserWorkflowPhase,
  type StudioPublishActivity,
} from "@/lib/generation-studio-workflow";

const queueSimulationEnabled =
  String(process.env.NEXT_PUBLIC_GENERATION_ALLOW_QUEUE_SIMULATION ?? "").toLowerCase() === "true";

type ContentType = "post" | "reel" | "story";
type Mode = "persona" | "faceless";
type ExecutionMode = "scene_based" | "multi_scene_single_video" | "ailiveai_single_video" | "single_image";
type OutputMedium = "video" | "photo";
/** AliveAI Create Prompt gender (blocking portrait + persona text). */
type AiliveaiGender = "FEMALE" | "MALE" | "TRANS";
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
  /** scene_pipeline = from DB scene fields; kie_quick_preview = dashboard "Img/Vid preview" API (Kie), not AliveAI. */
  preview_image_source?: string;
  preview_video_source?: string;
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
  /** scene_based | multi_scene_single_video | ailiveai_single_video */
  execution_mode?: string;
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

const NICHE_OPTIONS = ["fitness", "food", "travel", "business", "lifestyle"] as const;

function topicPlaceholderForNiche(
  niche: string,
  tp: Record<(typeof NICHE_OPTIONS)[number], string> & { egPrefix: string }
): string {
  const key = NICHE_OPTIONS.includes(niche as (typeof NICHE_OPTIONS)[number])
    ? (niche as (typeof NICHE_OPTIONS)[number])
    : "lifestyle";
  return tp[key];
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed" || status === "queued") return "default";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "ready" || status === "cancelling") return "secondary";
  if (status === "cancelled") return "outline";
  return "outline";
}

type JobCostEstimate = NonNullable<GenerationJobDetail["cost_estimate"]>;

function ControlSectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
  );
}

function FieldHint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={text}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function CostEstimatePanel({
  estimate,
  labels,
  t,
}: {
  estimate: JobCostEstimate;
  labels:
    | (typeof generationStudioI18n)["fr"]["controls"]
    | (typeof generationStudioI18n)["en"]["controls"];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
      <p className="font-semibold text-foreground">{labels.costEstimate}</p>
      {estimate.model ? (
        <p className="mt-1 text-muted-foreground">
          {estimate.model}
          {estimate.provider ? ` · ${estimate.provider}` : ""}
        </p>
      ) : null}
      <p className="mt-1 text-lg font-bold">{estimate.total_credits}</p>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {estimate.breakdown.map((b) => (
          <li key={b.line}>
            {estimate.model
              ? t("generationStudio.controls.costLineModel", {
                  line: b.line,
                  units: b.units,
                  credits: b.unit_credits,
                  subtotal: b.subtotal,
                })
              : t("generationStudio.controls.costLineGeneric", {
                  line: b.line,
                  units: b.units,
                  unitCredits: b.unit_credits,
                  subtotal: b.subtotal,
                })}
          </li>
        ))}
      </ul>
      {estimate.estimate_note ? (
        <p className="mt-2 border-t border-border pt-2 text-[11px] leading-snug text-muted-foreground">
          {estimate.estimate_note}
        </p>
      ) : null}
    </div>
  );
}

function stepMetadataSkipped(metadata: Record<string, unknown> | undefined): boolean {
  return metadata?.skipped === true;
}

/** Reasons where the work IS done, just inside the video_generation step (not a true skip). */
function stepMergedIntoVideoGeneration(metadata: Record<string, unknown> | undefined): boolean {
  if (!stepMetadataSkipped(metadata)) return false;
  const r = metadata?.reason;
  return r === "ailiveai_single_video_path" || r === "single_seedance_video_path";
}

/** Short label shown under the step name in place of "Skipped". */
function pipelineStepInlineLabel(
  metadata: Record<string, unknown> | undefined,
  pipe: GenerationStudioPipelineLabels
): string {
  if (stepMergedIntoVideoGeneration(metadata)) return pipe.doneInsideVideoGen;
  const reason = metadata?.reason;
  if (reason === "single_video_no_assembly_required") return pipe.notNeededSingleClip;
  return pipe.skipped;
}

function pipelineStepSkipHint(
  metadata: Record<string, unknown> | undefined,
  pipe: GenerationStudioPipelineLabels
): string | null {
  if (!stepMetadataSkipped(metadata)) return null;
  const reason = metadata?.reason;
  if (reason === "ailiveai_single_video_path") return pipe.skipHintAiliveai;
  if (reason === "single_seedance_video_path") return pipe.skipHintSeedance;
  if (reason === "single_video_no_assembly_required") return pipe.skipHintNoAssembly;
  if (typeof reason === "string" && reason.length > 0) return reason;
  return pipe.skipHintDefault;
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

function StepIcon({
  status,
  skipped,
  mergedIntoVideo,
  pipe,
}: {
  status: string;
  skipped?: boolean;
  mergedIntoVideo?: boolean;
  pipe: GenerationStudioPipelineLabels;
}) {
  if (status === "completed" && skipped) {
    const tooltip = mergedIntoVideo ? pipe.doneInsideVideoGen : pipe.skippedForMode;
    return (
      <span title={tooltip} className="inline-flex">
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

function GenerationStudioPageInner() {
  const { locale, text, t } = useLocale();
  const gs = text.generationStudio;
  const wf = gs.workflow;
  const ctrl = gs.controls;
  const tl = gs.timeline;
  const live = gs.liveJob;
  const progressLabels = useMemo(
    () => ({
      phaseDraft: live.phaseDraft,
      phaseReady: live.phaseReady,
      phaseStarting: live.phaseStarting,
      phaseSceneGen: live.phaseSceneGen,
      phaseImages: live.phaseImages,
      phasePhoto: live.phasePhoto,
      phaseVideo: live.phaseVideo,
      phaseVideoMotion: live.phaseVideoMotion,
      phaseVideoBolt: live.phaseVideoBolt,
      phaseAssembly: live.phaseAssembly,
      phaseFinalizing: live.phaseFinalizing,
      phaseDone: live.phaseDone,
      phaseFailed: live.phaseFailed,
      phaseCancelled: live.phaseCancelled,
      phaseCancelling: live.phaseCancelling,
      scenesProgress: t("generationStudio.liveJob.scenesProgress"),
      providerWait: live.providerWait,
      estimatedHint: live.estimatedHint,
      elapsed: live.elapsed,
    }),
    [live]
  );
  const editLabels = gs.edit;
  const toastMsg = gs.toasts;
  const pipe = gs.pipeline;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [contentType, setContentType] = useState<ContentType>("reel");
  const [outputMedium, setOutputMedium] = useState<OutputMedium>("video");
  const [mode, setMode] = useState<Mode>("faceless");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("multi_scene_single_video");
  /** AliveAI blocking image / persona LLM gender (API: MALE | FEMALE | TRANS). */
  const [ailiveaiGender, setAiliveaiGender] = useState<AiliveaiGender>("FEMALE");
  const [videoDuration, setVideoDuration] = useState<number>(15);
  const [niche, setNiche] = useState<string>("fitness");
  const [templateId, setTemplateId] = useState<string>("");
  const [topic, setTopic] = useState("");
  const [schedule, setSchedule] = useState<Date | undefined>(undefined);
  const [pipelineTargetAccountId, setPipelineTargetAccountId] = useState("");
  const [draftScenes, setDraftScenes] = useState<DraftScene[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [simulateLoading, setSimulateLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [abandonLoading, setAbandonLoading] = useState(false);
  const [abandonDialogOpen, setAbandonDialogOpen] = useState(false);
  const [cancelStepLoading, setCancelStepLoading] = useState<string | null>(null);
  const [retryStepLoading, setRetryStepLoading] = useState<string | null>(null);
  const retryStepInFlightRef = useRef(false);
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
  const [publishOpen, setPublishOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [publishActivity, setPublishActivity] = useState<StudioPublishActivity>("idle");

  // URL is the source of truth so sidebar navigation to /generation-studio clears the job immediately.
  const jobParam = searchParams.get("job")?.trim() ?? "";
  const studioTab = parseStudioTab(searchParams.get("tab"));
  const jobId = useMemo(
    () => (/^[0-9a-f-]{36}$/i.test(jobParam) ? jobParam : null),
    [jobParam]
  );

  useEffect(() => {
    if (outputMedium === "photo") {
      setExecutionMode("single_image");
      setContentType("post");
    } else if (executionMode === "single_image") {
      setExecutionMode("multi_scene_single_video");
    }
  }, [outputMedium]);

  useEffect(() => {
    if (executionMode === "ailiveai_single_video") {
      setMode("persona");
      setVideoDuration((d) => (d === 5 ? 5 : 10));
    }
  }, [executionMode]);

  // Drop stale multi-scene preview when leaving a job or switching to Motion.
  useEffect(() => {
    if (!jobId) {
      setDraftScenes([]);
    }
  }, [jobId]);

  useEffect(() => {
    if (executionMode === "multi_scene_single_video") {
      setDraftScenes((prev) => (prev.length > 1 ? [] : prev));
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

  useEffect(() => {
    if (job?.execution_mode === "single_image" || job?.input_payload?.output_medium === "photo") {
      setOutputMedium("photo");
      setExecutionMode("single_image");
      if (job?.input_payload?.content_type === "post") {
        setContentType("post");
      }
    }
  }, [job?.execution_mode, job?.input_payload?.output_medium, job?.input_payload?.content_type]);

  const isPhotoMode = useMemo(
    () =>
      ((job?.execution_mode as ExecutionMode | undefined) ?? executionMode) === "single_image" ||
      (job?.input_payload?.output_medium as string | undefined) === "photo" ||
      outputMedium === "photo",
    [job?.execution_mode, executionMode, job?.input_payload?.output_medium, outputMedium]
  );

  const studioMediaCopy = useMemo(
    () => ({
      launchGeneration: isPhotoMode ? ctrl.launchGenerationPhoto : ctrl.launchGeneration,
      description: isPhotoMode ? ctrl.descriptionPhoto : ctrl.description,
      sectionFormat: isPhotoMode ? ctrl.sectionFormatPhoto : ctrl.sectionFormat,
      publicationLocked: isPhotoMode ? wf.publicationLockedPhoto : wf.publicationLocked,
      publicationLockedDetail: isPhotoMode
        ? wf.publicationLockedDetailPhoto
        : wf.publicationLockedDetail,
      generateHint: isPhotoMode ? wf.stepHints.generatePhoto : wf.stepHints.generate,
      reviewHint: isPhotoMode ? wf.stepHints.reviewPhoto : wf.stepHints.review,
      pendingOutput: isPhotoMode ? live.pendingOutputPhoto : live.pendingOutput,
      nextReview: isPhotoMode ? wf.nextReviewPhoto : wf.nextReview,
      noJobForPublish: isPhotoMode ? wf.noJobForPublishPhoto : wf.noJobForPublish,
    }),
    [isPhotoMode, ctrl, wf, live]
  );

  const { data: dbNiches = [] } = useSWR<Array<{ id: string; name: string }>>(
    "content-niches",
    () => api.content.getNiches(),
    { revalidateOnFocus: false }
  );

  const nicheOptions = useMemo(() => {
    if (dbNiches.length > 0) {
      return dbNiches.map((n) => n.name);
    }
    return [...NICHE_OPTIONS];
  }, [dbNiches]);

  const nicheUuid = useMemo(
    () => dbNiches.find((n) => n.name === niche)?.id,
    [dbNiches, niche]
  );

  const templateListKey = nicheUuid ?? "__all_active__";

  const { data: nicheTemplates = [] } = useSWR<Array<{ id: string; name: string }>>(
    ["content-templates", templateListKey],
    () =>
      api.content.getTemplates(
        nicheUuid ? { niche_id: nicheUuid, active_only: true } : { active_only: true }
      ),
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    setTemplateId("");
  }, [niche]);

  const { data: accountChoices = [] } = useSWR<Array<{ id: string; username: string }>>(
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

  useEffect(() => {
    try {
      const stored = localStorage.getItem("generation-studio-pipeline-target-account-id");
      if (stored) setPipelineTargetAccountId(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!pipelineTargetAccountId) return;
    try {
      localStorage.setItem("generation-studio-pipeline-target-account-id", pipelineTargetAccountId);
    } catch {
      /* ignore */
    }
  }, [pipelineTargetAccountId]);

  useEffect(() => {
    if (!pipelineTargetAccountId || accountChoices.length === 0) return;
    if (!accountChoices.some((a) => a.id === pipelineTargetAccountId)) {
      setPipelineTargetAccountId("");
    }
  }, [accountChoices, pipelineTargetAccountId]);
  const { data: generatedAssets = [], isLoading: assetsLoading } = useSWR<GeneratedAsset[]>(
    jobId && job?.status === "completed" ? ["generation-job-assets", jobId] : null,
    () => api.generationJobs.getJobAssets(jobId as string),
    { refreshInterval: 0 }
  );

  const workflowPhase = useMemo(
    () => deriveStudioWorkflowPhase(job?.status, publishActivity),
    [job?.status, publishActivity]
  );
  const publicationUnlocked = isPublicationTabUnlocked(workflowPhase);
  const creationComplete = job?.status === "completed";

  const userWorkflowPhase = useMemo(
    () =>
      resolveStudioUserWorkflowPhase({
        studioTab,
        jobId,
        jobStatus: job?.status,
      }),
    [studioTab, jobId, job?.status],
  );

  const workflowNextHint = useMemo(() => {
    switch (userWorkflowPhase) {
      case "configure":
        return wf.nextConfigure;
      case "generate":
        return wf.nextGenerate;
      case "review":
        return studioMediaCopy.nextReview;
      case "publish":
        return wf.nextPublish;
      default:
        return wf.nextConfigure;
    }
  }, [userWorkflowPhase, wf, studioMediaCopy.nextReview]);

  useEffect(() => {
    setPublishActivity("idle");
  }, [jobId]);

  const handleStudioTabChange = useCallback(
    (value: string) => {
      if (value === "publication" && !publicationUnlocked) return;
      const tab = value === "publication" ? "publication" : "creation";
      const params = new URLSearchParams(searchParams.toString());
      if (tab === "creation") params.delete("tab");
      else params.set("tab", "publication");
      const query = params.toString();
      router.replace(query ? `/generation-studio?${query}` : "/generation-studio", { scroll: false });
    },
    [publicationUnlocked, router, searchParams]
  );

  useEffect(() => {
    if (studioTab === "publication" && !publicationUnlocked) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("tab");
      const query = params.toString();
      router.replace(query ? `/generation-studio?${query}` : "/generation-studio", { scroll: false });
    }
  }, [studioTab, publicationUnlocked, router, searchParams]);

  const liveJobClip = useMemo(() => {
    if (!jobId || !job) return { url: null as string | null, note: "" as string, mediaKind: "video" as const };
    if (job.status === "completed") {
      if (job.output_url) {
        return {
          url: job.output_url,
          note: "",
          mediaKind: isPhotoMode ? ("image" as const) : ("video" as const),
        };
      }
      if (isPhotoMode) {
        const img = generatedAssets.find((a) => a.asset_type === "image");
        return { url: img?.public_url ?? null, note: "", mediaKind: "image" as const };
      }
      const v = generatedAssets.find((a) => a.asset_type === "video");
      return { url: v?.public_url ?? null, note: "", mediaKind: "video" as const };
    }
    if (job.output_url) {
      return { url: job.output_url, note: live.outputStaleNote, mediaKind: isPhotoMode ? ("image" as const) : ("video" as const) };
    }
    const scenes = [...(job.scenes || [])].sort((a, b) => a.scene_index - b.scene_index);
    const first = scenes[0] as JobScene | undefined;
    const m = first?.metadata;
    const pv = m && typeof m.preview_video_url === "string" && m.preview_video_url.trim() ? m.preview_video_url.trim() : "";
    if (!pv) return { url: null, note: "", mediaKind: "video" as const };
    if (m?.preview_video_source === "kie_quick_preview") {
      return { url: pv, note: live.kiePreviewNote, mediaKind: "video" as const };
    }
    if (m?.preview_video_source === "scene_pipeline") {
      return { url: pv, note: live.scenePipelineNote, mediaKind: "video" as const };
    }
    return { url: pv, note: live.scenePreviewUntagged, mediaKind: "video" as const };
  }, [jobId, job, generatedAssets, live, isPhotoMode]);

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
    if (jobId && job?.scenes?.length) {
      return [...job.scenes].sort((a, b) => a.scene_index - b.scene_index);
    }
    return [...draftScenes].sort((a, b) => a.scene_index - b.scene_index);
  }, [jobId, job, draftScenes]);

  const totalDurationSec = useMemo(
    () => sortedScenes.reduce((acc, s) => acc + (s.duration || 0), 0),
    [sortedScenes]
  );
  const activeExecutionMode = (job?.execution_mode as ExecutionMode | undefined) ?? executionMode;
  const isMotionMode = activeExecutionMode === "multi_scene_single_video";
  const clipDurationSec = useMemo(() => {
    if (isMotionMode || activeExecutionMode === "ailiveai_single_video") {
      const fromJob = job?.input_payload?.video_duration;
      if (typeof fromJob === "number" && Number.isFinite(fromJob)) return fromJob;
      if (typeof fromJob === "string" && fromJob.trim()) {
        const parsed = Number(fromJob);
        if (Number.isFinite(parsed)) return parsed;
      }
      return videoDuration;
    }
    return totalDurationSec;
  }, [activeExecutionMode, isMotionMode, job?.input_payload?.video_duration, totalDurationSec, videoDuration]);
  const motionPrimaryScene = sortedScenes[0];
  const motionMasterPrompt = useMemo(() => {
    if (sortedScenes.length === 0) return "";
    if (sortedScenes.length === 1) return (sortedScenes[0].prompt || "").trim();
    const lines = ["Create a continuous cinematic video.", "", "Narrative progression:", ""];
    sortedScenes.forEach((s, i) => lines.push(`${i + 1}. ${(s.prompt || "").trim()}`));
    lines.push("", `Target duration: approximately ${clipDurationSec} seconds`);
    return lines.join("\n");
  }, [sortedScenes, clipDurationSec]);
  const canLaunch = job && (job.status === "draft" || job.status === "ready");
  const jobIsCancelling = job?.status === "cancelling";
  const jobIsCancelled = job?.status === "cancelled";
  const canStopPipeline = job && (job.status === "running" || job.status === "pending");
  const canAbandonJob = Boolean(job && canAbandonGenerationJob(job.status));
  const sceneActionsLocked = Boolean(jobIsCancelling);
  const sceneRegenDisabled = Boolean(jobIsCancelling || jobIsCancelled);
  const livePollActive = job && ["running", "pending", "cancelling"].includes(job.status);
  const isVerticalVideo = contentType === "reel" || contentType === "story";
  const pipelineFailureSummary = useMemo(
    () => (job ? summarizeJobPipelineErrors(job) : null),
    [job],
  );
  const parseApiError = (e: unknown, fallback: string) => formatContentApiError(e, fallback);

  const handlePreview = async () => {
    if (!topic.trim()) {
      toast.error(toastMsg.topicRequired);
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
      router.replace("/generation-studio", { scroll: false });
      toast.success(toastMsg.previewReady);
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.previewError));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCreateDraft = async () => {
    if (!topic.trim()) {
      toast.error(toastMsg.topicRequired);
      return;
    }
    setCreateLoading(true);
    try {
      const res = await api.generationJobs.create({
        execution_mode: executionMode,
        content_type: contentType,
        ...(isPhotoMode ? { output_medium: "photo" as const } : {}),
        mode,
        niche,
        topic: topic.trim(),
        target_accounts: pipelineTargetAccountId ? [pipelineTargetAccountId] : [],
        scheduled_at: schedule ? schedule.toISOString() : undefined,
        ...(templateId ? { template_id: templateId } : {}),
        video_duration:
          executionMode === "multi_scene_single_video" || executionMode === "ailiveai_single_video"
            ? videoDuration
            : undefined,
        ...(executionMode === "ailiveai_single_video" ? { ailiveai_gender: ailiveaiGender } : {}),
      });
      addTrackedGenerationJobId(res.job_id);
      router.replace(`/generation-studio?job=${encodeURIComponent(res.job_id)}`, { scroll: false });
      toast.success(toastMsg.draftCreated);
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.draftError));
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
      toast.success(toastMsg.pipelineStarted);
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.launchError));
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
      toast.success(toastMsg.stoppingKept);
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.stopError));
    } finally {
      setCancelLoading(false);
    }
  };

  const handleAbandonJob = async () => {
    if (!jobId) return;
    setAbandonLoading(true);
    try {
      await api.generationJobs.delete(jobId);
      toast.success(toastMsg.jobAbandoned);
      setAbandonDialogOpen(false);
      router.replace("/generation-studio", { scroll: false });
    } catch (e: unknown) {
      const detail = parseApiError(e, toastMsg.abandonError);
      toast.error(
        detail.toLowerCase().includes("running") || detail.toLowerCase().includes("cancel")
          ? toastMsg.abandonRunningError
          : detail
      );
    } finally {
      setAbandonLoading(false);
    }
  };

  const handleMarkReady = async () => {
    if (!jobId) return;
    setReadyLoading(true);
    try {
      await api.generationJobs.markReady(jobId);
      await mutate();
      toast.success(toastMsg.markedReady);
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.markReadyError));
    } finally {
      setReadyLoading(false);
    }
  };

  const handleSimulateQueue = async () => {
    setSimulateLoading(true);
    try {
      const res = await api.generationJobs.simulateQueueEntry({
        job_id: jobId ?? undefined,
        execution_mode: executionMode,
        content_type: contentType,
        mode,
        niche,
        topic: topic.trim() || undefined,
        target_accounts: pipelineTargetAccountId ? [pipelineTargetAccountId] : [],
      });
      if (res.job_id) {
        addTrackedGenerationJobId(res.job_id);
      }
      toast.success(toastMsg.simulateQueueSuccess);
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.simulateQueueError));
    } finally {
      setSimulateLoading(false);
    }
  };

  const handleSceneMediaPreview = async (sceneId: string, kind: "image" | "video") => {
    if (!jobId) return;
    setPreviewingTarget({ sceneId, kind });
    try {
      await api.generationJobs.previewScene(jobId, sceneId, kind);
      await mutate();
      toast.success(kind === "video" ? toastMsg.videoPreviewDone : toastMsg.imagePreviewDone);
      if (kind === "video") {
        setOpenSceneVideoId(sceneId);
      }
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.previewGenError));
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
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.reorderError));
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
        toast.success(toastMsg.sceneUpdated);
      } catch (e: unknown) {
        toast.error(parseApiError(e, toastMsg.updateError));
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
      toast.success(toastMsg.draftSceneUpdated);
    }
    setEditOpen(false);
  };

  const regenerateScene = async (scene: JobScene | DraftScene) => {
    const isServer = "id" in scene && !!(scene as JobScene).id;
    if (isServer && jobId) {
      if (job?.status === "draft" || job?.status === "ready") {
        toast.error(toastMsg.launchBeforeRetry);
        return;
      }
      if (retryStepInFlightRef.current) return;
      retryStepInFlightRef.current = true;
      try {
        await api.generationJobs.retryScene(jobId, (scene as JobScene).id);
        await mutate();
        toast.success(toastMsg.sceneRegenScheduled);
      } catch (e: unknown) {
        toast.error(parseApiError(e, toastMsg.retryError));
      } finally {
        retryStepInFlightRef.current = false;
      }
      return;
    }
    await handlePreview();
  };

  const retryStep = async (stepName: string) => {
    if (!jobId || retryStepInFlightRef.current) return;
    retryStepInFlightRef.current = true;
    setRetryStepLoading(stepName);
    try {
      await api.generationJobs.retryStep(jobId, stepName);
      await mutate();
      toast.success(t("generationStudio.toasts.stepRetryScheduled", { step: stepName }));
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      toast.error(
        parseApiError(
          e,
          status === 409 ? toastMsg.retryStepAlreadyRunning : toastMsg.retryStepError
        )
      );
    } finally {
      retryStepInFlightRef.current = false;
      setRetryStepLoading(null);
    }
  };

  const cancelStep = async (stepName: string) => {
    if (!jobId) return;
    setCancelStepLoading(stepName);
    try {
      await api.generationJobs.cancelStep(jobId, stepName);
      await mutate();
      toast.success(t("generationStudio.toasts.stepStopping", { step: stepName }));
    } catch (e: unknown) {
      toast.error(parseApiError(e, toastMsg.cancelStepError));
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

  const topicPlaceholder = useMemo(
    () => topicPlaceholderForNiche(niche, gs.topicPlaceholders),
    [niche, gs.topicPlaceholders]
  );

  const topicSuggestion = useMemo(
    () => topicPlaceholder.replace(new RegExp(`^${gs.topicPlaceholders.egPrefix}`, "i"), "").trim(),
    [topicPlaceholder, gs.topicPlaceholders.egPrefix]
  );

  return (
    <TooltipProvider delayDuration={300}>
    <div className="flex-1 min-h-screen bg-neutral-50 p-6 dark:bg-neutral-950">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
            {gs.pageTitle}
          </h1>
          <p className="text-sm text-muted-foreground">{gs.pageSubtitle}</p>
        </div>

        <GenerationStudioWorkflowBar
          phase={userWorkflowPhase}
          labels={{
            configure: wf.steps.configure,
            generate: wf.steps.generate,
            review: wf.steps.review,
            publish: wf.steps.publish,
            configureHint: wf.stepHints.configure,
            generateHint: studioMediaCopy.generateHint,
            reviewHint: studioMediaCopy.reviewHint,
            publishHint: wf.stepHints.publish,
          }}
          nextHint={workflowNextHint}
        />

        <Tabs value={studioTab} onValueChange={handleStudioTabChange} className="w-full">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <TabsList className="h-11 w-full shrink-0 sm:w-auto">
              <TabsTrigger value="creation" className="gap-1.5 px-4">
                {wf.tabCreation}
                {creationComplete ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                ) : null}
              </TabsTrigger>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <TabsTrigger
                      value="publication"
                      disabled={!publicationUnlocked}
                      className="gap-1.5 px-4"
                      aria-description={!publicationUnlocked ? studioMediaCopy.publicationLocked : undefined}
                    >
                      {!publicationUnlocked ? (
                        <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                      ) : null}
                      {wf.tabPublication}
                    </TabsTrigger>
                  </span>
                </TooltipTrigger>
                {!publicationUnlocked ? (
                  <TooltipContent side="bottom" className="max-w-xs">
                    {studioMediaCopy.publicationLocked}
                  </TooltipContent>
                ) : null}
              </Tooltip>
            </TabsList>
            <p className="text-xs text-muted-foreground sm:max-w-md sm:text-right">
              {publicationUnlocked ? wf.publicationTabHint : studioMediaCopy.publicationLockedDetail}
            </p>
          </div>

          <TabsContent value="creation" className="mt-4 space-y-6 focus-visible:outline-none">
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="flex flex-col lg:col-span-3 lg:max-h-[calc(100vh-5rem)] lg:sticky lg:top-6">
            <CardHeader className="shrink-0 pb-3">
              <CardTitle className="text-base">{ctrl.title}</CardTitle>
              <CardDescription>{studioMediaCopy.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
                <section className="space-y-3">
                  <ControlSectionTitle>{ctrl.sectionCreate}</ControlSectionTitle>
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor="gs-topic">{ctrl.topic}</Label>
                      <FieldHint text={ctrl.topicHintSr} />
                    </div>
                    <div className="relative flex items-center">
                      <Input
                        id="gs-topic"
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
                        title={t("generationStudio.controls.useSuggestion", { suggestion: topicSuggestion })}
                        aria-label={ctrl.fillTopicSuggestion}
                        onClick={() => setTopic(topicSuggestion)}
                      >
                        <Sparkles className="h-4 w-4" />
                      </Button>
                    </div>
                    <p id="topic-suggestion-hint" className="sr-only">
                      {ctrl.topicHintSr}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>{ctrl.outputMedium}</Label>
                    <Select
                      value={outputMedium}
                      onValueChange={(v) => setOutputMedium(v as OutputMedium)}
                      disabled={Boolean(jobId)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="video">{ctrl.outputVideo}</SelectItem>
                        <SelectItem value="photo">{ctrl.outputPhoto}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {outputMedium === "video" ? (
                  <div className="space-y-2">
                    <Label>{ctrl.executionMode}</Label>
                    <Select value={executionMode} onValueChange={(v) => setExecutionMode(v as ExecutionMode)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="multi_scene_single_video">{ctrl.execMultiSeedance}</SelectItem>
                        <SelectItem value="ailiveai_single_video">{ctrl.execAiliveai}</SelectItem>
                        {SCENE_BASED_EXECUTION_UI_ENABLED ? (
                          <SelectItem value="scene_based">{ctrl.execSceneKie}</SelectItem>
                        ) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{ctrl.execSingleImage}</p>
                  )}
                  {outputMedium === "video" &&
                  (executionMode === "multi_scene_single_video" || executionMode === "ailiveai_single_video") ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label>{ctrl.videoDuration}</Label>
                        <FieldHint
                          text={
                            executionMode === "ailiveai_single_video"
                              ? ctrl.aliveaiDurationHint
                              : ctrl.seedanceDurationHint
                          }
                        />
                      </div>
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
                              <SelectItem value="5">{ctrl.durAliveai5}</SelectItem>
                              <SelectItem value="10">{ctrl.durAliveai10}</SelectItem>
                            </>
                          ) : (
                            <>
                              {[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                  {t("generationStudio.controls.durSeconds", { n })}
                                </SelectItem>
                              ))}
                            </>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {outputMedium === "video" && executionMode === "ailiveai_single_video" ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <Label>{ctrl.presenterGender}</Label>
                        <FieldHint text={ctrl.aliveaiGenderHint} />
                      </div>
                      <Select
                        value={ailiveaiGender}
                        onValueChange={(v) => setAiliveaiGender(v as AiliveaiGender)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="FEMALE">{ctrl.genderFemale}</SelectItem>
                          <SelectItem value="MALE">{ctrl.genderMale}</SelectItem>
                          <SelectItem value="TRANS">{ctrl.genderTrans}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </section>

                <section className="space-y-3">
                  <ControlSectionTitle>{studioMediaCopy.sectionFormat}</ControlSectionTitle>
                  <div className={cn("grid gap-3", outputMedium === "photo" || executionMode === "ailiveai_single_video" ? "grid-cols-1" : "grid-cols-2")}>
                    <div className="space-y-2">
                      <Label>{ctrl.contentType}</Label>
                      <Select
                        value={contentType}
                        onValueChange={(v) => setContentType(v as ContentType)}
                        disabled={outputMedium === "photo"}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="post">{gs.publish.post}</SelectItem>
                          {outputMedium === "video" ? (
                            <>
                              <SelectItem value="reel">{gs.publish.reel}</SelectItem>
                              <SelectItem value="story">{gs.publish.story}</SelectItem>
                            </>
                          ) : null}
                        </SelectContent>
                      </Select>
                    </div>
                    {outputMedium === "video" && executionMode !== "ailiveai_single_video" ? (
                      <div className="space-y-2">
                        <Label>{ctrl.presence}</Label>
                        <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="persona">{ctrl.onCamera}</SelectItem>
                            <SelectItem value="faceless">{ctrl.faceless}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label>{ctrl.niche}</Label>
                    <Select value={niche} onValueChange={setNiche}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {nicheOptions.map((n) => (
                          <SelectItem key={n} value={n}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </section>

                <section className="space-y-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md py-1 text-left"
                    aria-expanded={publishOpen}
                    onClick={() => setPublishOpen((o) => !o)}
                  >
                    <div>
                      <ControlSectionTitle>{ctrl.sectionQueuePrep}</ControlSectionTitle>
                      {!publishOpen ? (
                        <p className="text-xs text-muted-foreground">{ctrl.sectionQueuePrepSummary}</p>
                      ) : null}
                    </div>
                    {publishOpen ? (
                      <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                  {publishOpen ? (
                    <div className="space-y-3 border-l-2 border-border/60 pl-3">
                      <div className="space-y-2">
                        <Label>{ctrl.templateOptional}</Label>
                        <Select
                          value={templateId || "__none__"}
                          onValueChange={(v) => setTemplateId(v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={ctrl.noTemplate} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{ctrl.noTemplate}</SelectItem>
                            {nicheTemplates.map((tpl) => (
                              <SelectItem key={tpl.id} value={tpl.id}>
                                {tpl.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-1.5">
                          <Label>{ctrl.targetAccount}</Label>
                          <FieldHint text={ctrl.targetAccountHint} />
                        </div>
                        <Select
                          value={pipelineTargetAccountId || "__none__"}
                          onValueChange={(v) => setPipelineTargetAccountId(v === "__none__" ? "" : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={ctrl.targetAccountNone} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{ctrl.targetAccountNone}</SelectItem>
                            {accountChoices.map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                @{account.username}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>{ctrl.schedule}</Label>
                        <DateTimePicker
                          value={schedule}
                          onChange={setSchedule}
                          placeholder={gs.publish.pickDateTime}
                        />
                      </div>
                    </div>
                  ) : null}
                </section>

                {queueSimulationEnabled ? (
                  <section className="space-y-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md py-1 text-left"
                      aria-expanded={advancedOpen}
                      onClick={() => setAdvancedOpen((o) => !o)}
                    >
                      <ControlSectionTitle>{ctrl.sectionAdvanced}</ControlSectionTitle>
                      {advancedOpen ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                    {advancedOpen ? (
                      <div className="space-y-2 border-l-2 border-border/60 pl-3">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          disabled={simulateLoading}
                          onClick={() => void handleSimulateQueue()}
                        >
                          {simulateLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ListOrdered className="h-4 w-4" />
                          )}
                          {ctrl.simulateQueue}
                        </Button>
                        <p className="text-xs text-muted-foreground">{ctrl.simulateQueueHint}</p>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </div>

              <div className="shrink-0 space-y-2 border-t border-border bg-card px-6 py-4">
                <Button type="button" variant="secondary" className="w-full" disabled={previewLoading} onClick={handlePreview}>
                  {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {isPhotoMode || executionMode === "multi_scene_single_video" ? ctrl.previewPrompt : ctrl.previewScenes}
                </Button>
                <Button type="button" className="w-full" disabled={createLoading} onClick={handleCreateDraft}>
                  {createLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                  {ctrl.createDraft}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-base">
                {isMotionMode || isPhotoMode ? ctrl.scriptPanelTitle : tl.title}
              </CardTitle>
              <CardDescription>
                {isMotionMode || isPhotoMode
                  ? t(
                      isPhotoMode
                        ? "generationStudio.timeline.singlePhotoDescription"
                        : "generationStudio.timeline.singlePromptDescription",
                      { seconds: clipDurationSec }
                    )
                  : t("generationStudio.timeline.description", { seconds: totalDurationSec })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {jobId && jobLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {tl.loadingScenes}
                </div>
              ) : sortedScenes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {isMotionMode || isPhotoMode ? tl.singlePromptEmpty : tl.empty}
                </p>
              ) : isMotionMode || isPhotoMode ? (
                <>
                  {sortedScenes.length > 1 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300/90">
                      {t("generationStudio.timeline.legacyMultiPromptNote", { count: sortedScenes.length })}
                    </p>
                  ) : null}
                  <div className="rounded-lg border border-border bg-card/60 p-3 shadow-sm">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      {motionPrimaryScene && "status" in motionPrimaryScene && motionPrimaryScene.status ? (
                        <Badge variant={statusBadgeVariant(motionPrimaryScene.status)}>{motionPrimaryScene.status}</Badge>
                      ) : (
                        <Badge variant="outline">local</Badge>
                      )}
                      {sortedScenes.length === 1 && motionPrimaryScene ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={sceneActionsLocked}
                          onClick={() => openEdit(motionPrimaryScene)}
                        >
                          {tl.edit}
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{motionMasterPrompt}</p>
                  </div>
                </>
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
                            title={tl.previewUnderScene}
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
                              <span className="text-xs font-medium text-muted-foreground">
                                {t("generationStudio.timeline.scene", { index: scene.scene_index })}
                              </span>
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
                                    {tl.imgPreview}
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
                                    {videoPanelOpen ? tl.hideVideo : tl.vidPreview}
                                  </Button>
                                </>
                              ) : null}
                              <Button size="sm" variant="outline" disabled={sceneActionsLocked} onClick={() => openEdit(scene)}>
                                {tl.edit}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={sceneActionsLocked || sceneRegenDisabled}
                                onClick={() => regenerateScene(scene)}
                              >
                                {tl.retryMedia}
                              </Button>
                            </div>
                          </div>
                          <div className="space-y-3">
                            <p className="text-sm leading-relaxed">{scene.prompt}</p>
                            {imagePreviewSrc ? (
                              <div
                                className={cn(
                                  "relative mx-auto overflow-hidden rounded-lg border border-border/50 bg-muted/20 ring-1 ring-black/[0.04] dark:ring-white/[0.06]",
                                  isVerticalVideo ? "max-w-[min(100%,240px)]" : "max-w-md"
                                )}
                              >
                                <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border border-border/60 bg-background/90 p-0.5 shadow-sm backdrop-blur-sm">
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    aria-label={tl.viewFullscreen}
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
                                    aria-label={imageFolded ? tl.showImagePreview : tl.hideImagePreview}
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
                                    className="flex w-full justify-center bg-black/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    onClick={() => setImageLightboxSrc(imagePreviewSrc)}
                                    aria-label={tl.openFullscreen}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      alt=""
                                      src={imagePreviewSrc}
                                      className={cn(
                                        "max-h-[360px] w-auto max-w-full object-contain",
                                        isVerticalVideo ? "aspect-[9/16]" : "aspect-video max-h-[280px]"
                                      )}
                                    />
                                  </button>
                                ) : (
                                  <div className="flex min-h-[3.5rem] items-center bg-muted/30 pl-3 pr-[4.5rem]">
                                    <span className="text-xs text-muted-foreground">{tl.imageHidden}</span>
                                  </div>
                                )}
                                {meta?.preview_image_source === "kie_quick_preview" && !imageFolded ? (
                                  <p className="border-t border-border/40 bg-muted/20 px-2 py-1 text-center text-[10px] text-muted-foreground">
                                    {tl.kieFrameNote}
                                  </p>
                                ) : null}
                                {meta?.preview_image_source === "ailiveai_blocking_preview" && !imageFolded ? (
                                  <p className="border-t border-border/40 bg-muted/20 px-2 py-1 text-center text-[10px] text-muted-foreground">
                                    {tl.aliveaiPortraitNote}
                                  </p>
                                ) : null}
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
                                  {meta?.preview_video_source === "kie_quick_preview" ? (
                                    <p className="mb-1 text-center text-[10px] leading-tight text-amber-700 dark:text-amber-300/90">
                                      {tl.kieVideoNote}
                                    </p>
                                  ) : null}
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
              <CardTitle className="text-base">{ctrl.progressPanelTitle}</CardTitle>
              <CardDescription>
                {livePollActive || (jobId && job && job.status === "completed")
                  ? jobIsCancelling
                    ? live.pollingStopping
                    : live.pollingActive
                  : live.pollingIdle}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!jobId ? (
                <p className="text-sm text-muted-foreground">{live.noJobHint}</p>
              ) : jobLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {live.loadingStatus}
                </div>
              ) : jobError ? (
                <p className="text-sm text-destructive">{live.loadError}</p>
              ) : !job ? (
                <p className="text-sm text-muted-foreground">{live.noData}</p>
              ) : (
                <>
              {job.status === "draft" || job.status === "ready" ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("generationStudio.liveJob.generationLine", {
                        status: job.status,
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("generationStudio.liveJob.draftReadyHint", { status: job.status })}
                  </p>
                  <LiveJobProgress job={job} labels={progressLabels} locale={locale} elapsedLabel={live.elapsed} />
                  {job.cost_estimate ? (
                    <CostEstimatePanel estimate={job.cost_estimate} labels={ctrl} t={t} />
                  ) : null}
                  {canLaunch ? (
                    <div className="flex flex-col gap-2">
                      <Button type="button" variant="secondary" disabled={readyLoading} onClick={handleMarkReady}>
                        {readyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        {ctrl.markReady}
                      </Button>
                      <Button type="button" disabled={launchLoading} onClick={handleLaunchPipeline}>
                        {launchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                        {studioMediaCopy.launchGeneration}
                      </Button>
                    </div>
                  ) : null}
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
                      {live.cancelJob}
                    </Button>
                  ) : null}
                  {jobIsCancelling ? (
                    <p className="text-xs text-muted-foreground">{live.stoppingGeneration}</p>
                  ) : null}
                </div>
              ) : (
                <>
                  <LiveJobProgress job={job} labels={progressLabels} locale={locale} elapsedLabel={live.elapsed} />
                  <div className="flex w-full flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
                        {jobIsCancelling ? (
                          <span className="text-xs text-muted-foreground">{live.stopping}</span>
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
                          {live.cancelJob}
                        </Button>
                      ) : null}
                  </div>

                  {job.status === "failed" && pipelineFailureSummary ? (
                    <Alert variant="destructive">
                      <AlertTitle>{live.pipelineFailed}</AlertTitle>
                      <AlertDescription className="text-sm">{pipelineFailureSummary}</AlertDescription>
                    </Alert>
                  ) : null}

                  {job.cost_estimate ? (
                    <CostEstimatePanel estimate={job.cost_estimate} labels={ctrl} t={t} />
                  ) : null}

                  {liveJobClip.url ? (
                    <div className="space-y-1">
                      {liveJobClip.note ? (
                        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300/90">{liveJobClip.note}</p>
                      ) : null}
                      <div className="overflow-hidden rounded-md border bg-black">
                        {liveJobClip.mediaKind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={liveJobClip.url}
                            src={liveJobClip.url}
                            alt=""
                            className="aspect-square max-h-[320px] w-full object-contain"
                          />
                        ) : (
                          <video
                            key={liveJobClip.url}
                            src={liveJobClip.url}
                            className="aspect-[9/16] max-h-[320px] w-full object-contain"
                            controls
                            playsInline
                          />
                        )}
                      </div>
                    </div>
                  ) : job.status === "completed" && assetsLoading ? (
                    <div className="flex aspect-video items-center justify-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {live.loadingOutput}
                    </div>
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-md border border-dashed px-3 text-center text-xs text-muted-foreground">
                      {jobIsCancelled
                        ? live.cancelledPartial
                        : job.status === "completed"
                          ? live.completedNoUrl
                          : job.status === "failed"
                            ? live.failedNoUrl
                            : studioMediaCopy.pendingOutput}
                    </div>
                  )}

                  {creationComplete && publicationUnlocked && studioTab === "creation" ? (
                    <Button
                      type="button"
                      className="w-full gap-2"
                      onClick={() => handleStudioTabChange("publication")}
                    >
                      <Rocket className="h-4 w-4" />
                      {wf.goToPublication}
                    </Button>
                  ) : null}

                  <Tabs defaultValue="steps">
                    <TabsList className="w-full">
                      <TabsTrigger className="flex-1" value="steps">
                        {live.steps}
                      </TabsTrigger>
                      <TabsTrigger className="flex-1" value="logs">
                        {live.logs}
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="steps" className="mt-3 space-y-2">
                      {job.steps.map((s) => {
                        const ctrl = pipelineStepControl(s.step_name, s.status);
                        const stepSkipped = stepMetadataSkipped(s.metadata);
                        const stepMergedIntoVideo = stepMergedIntoVideoGeneration(s.metadata);
                        const skipHint = pipelineStepSkipHint(s.metadata, pipe);
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
                              <StepIcon
                                status={s.status}
                                skipped={stepSkipped}
                                mergedIntoVideo={stepMergedIntoVideo}
                                pipe={pipe}
                              />
                              <div className="min-w-0">
                                <p className="font-medium leading-none">{s.step_name}</p>
                                {stepSkipped && s.status === "completed" ? (
                                  <p className="text-xs text-muted-foreground">
                                    {pipelineStepInlineLabel(s.metadata, pipe)}
                                  </p>
                                ) : (
                                  <>
                                    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                      {s.status === "running" && s.progress > 0 && s.progress < 100 ? (
                                        <span className="font-mono tabular-nums">{s.progress}%</span>
                                      ) : s.status === "completed" ? (
                                        <span>{live.phaseDone}</span>
                                      ) : null}
                                      {videoGenStartedAt ? (
                                        <span>
                                          {t("generationStudio.liveJob.generationStarted", { at: videoGenStartedAt })}
                                        </span>
                                      ) : null}
                                    </p>
                                    {typeof s.metadata?.video_scenes_completed === "number" &&
                                    typeof s.metadata?.video_scenes_total === "number" ? (
                                      <p className="text-xs text-muted-foreground">
                                        {t("generationStudio.liveJob.scenesProgress", {
                                          done: s.metadata.video_scenes_completed,
                                          total: s.metadata.video_scenes_total,
                                        })}
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
                                  <p className="mt-1 text-xs text-amber-700">{live.cancelling}</p>
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
                                      {live.cancel}
                                    </span>
                                  ) : (
                                    live.cancel
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
                                  job.status === "running" ||
                                  jobIsCancelling ||
                                  jobIsCancelled ||
                                  ctrl === "cancelling" ||
                                  ctrl === "cancelled" ||
                                  s.status === "cancelled" ||
                                  s.status === "running" ||
                                  retryStepLoading !== null
                                }
                                onClick={() => retryStep(s.step_name)}
                              >
                                {retryStepLoading === s.step_name ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    {live.retry}
                                  </span>
                                ) : (
                                  live.retry
                                )}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </TabsContent>
                    <TabsContent value="logs" className="mt-3 max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                      {logs.length === 0 ? (
                        <span className="text-muted-foreground">{live.noLogs}</span>
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
              {canAbandonJob ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 dark:border-destructive/60"
                  disabled={abandonLoading}
                  onClick={() => setAbandonDialogOpen(true)}
                >
                  <Trash2 className="h-3 w-3" />
                  {live.abandonJob}
                </Button>
              ) : canStopPipeline ? (
                <p className="text-xs text-muted-foreground">{live.abandonRunningHint}</p>
              ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
          </TabsContent>

          <TabsContent value="publication" className="mt-4 focus-visible:outline-none">
            {!jobId ? (
              <Alert>
                <AlertTitle>{wf.tabPublication}</AlertTitle>
                <AlertDescription>{studioMediaCopy.noJobForPublish}</AlertDescription>
              </Alert>
            ) : !publicationUnlocked ? (
              <Alert>
                <AlertTitle className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  {wf.tabPublication}
                </AlertTitle>
                <AlertDescription>{studioMediaCopy.publicationLockedDetail}</AlertDescription>
              </Alert>
            ) : assetsLoading ? (
              <Card>
                <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {wf.loadingAssets}
                </CardContent>
              </Card>
            ) : (
              <div className="w-full min-w-0">
                <GenerationStudioPublishPanel
                  jobId={jobId}
                  assets={generatedAssets}
                  accounts={accountChoices}
                  publishNiche={String(job?.input_payload?.niche ?? niche ?? "lifestyle")}
                  publishTopic={String(job?.input_payload?.topic ?? topic ?? "")}
                  preferPhotoAsset={isPhotoMode}
                  onPublishActivity={setPublishActivity}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

      <Dialog
        open={imageLightboxSrc !== null}
        onOpenChange={(open) => {
          if (!open) setImageLightboxSrc(null);
        }}
      >
        <DialogContent className="flex max-h-[95vh] max-w-[min(96vw,1200px)] flex-col gap-0 border-border/40 bg-black p-2 sm:p-4">
          <DialogHeader className="sr-only">
            <DialogTitle>{editLabels.imageLightbox}</DialogTitle>
          </DialogHeader>
          {imageLightboxSrc ? (
            <div className="flex min-h-[min(88vh,900px)] w-full flex-1 items-center justify-center overflow-auto">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageLightboxSrc}
                alt=""
                className="h-auto max-h-[min(88vh,900px)] w-auto max-w-full object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editLabels.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>{editLabels.prompt}</Label>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{editLabels.duration}</Label>
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
              <Label>{editLabels.role}</Label>
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
              {editLabels.cancel}
            </Button>
            <Button onClick={saveEdit}>{editLabels.save}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={abandonDialogOpen}
        onOpenChange={setAbandonDialogOpen}
        title={live.abandonDialogTitle}
        description={live.abandonConfirm}
        deleteLabel={text.readyQueue.delete}
        cancelLabel={editLabels.cancel}
        onConfirm={handleAbandonJob}
        loading={abandonLoading}
      />
      </div>
    </div>
    </TooltipProvider>
  );
}

function StudioLoadingFallback() {
  const { text } = useLocale();
  return (
    <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
      {text.generationStudio.loadingStudio}
    </div>
  );
}

export default function GenerationStudioPage() {
  return (
    <Suspense fallback={<StudioLoadingFallback />}>
      <GenerationStudioPageInner />
    </Suspense>
  );
}
