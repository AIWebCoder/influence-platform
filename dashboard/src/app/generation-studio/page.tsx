"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { api } from "@/lib/api";
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
import { CheckCircle2, ChevronDown, Circle, GripVertical, Loader2, RefreshCw, Rocket, Square, Video, XCircle } from "lucide-react";
import toast from "react-hot-toast";

type ContentType = "post" | "reel" | "story";
type Mode = "persona" | "faceless";
type ExecutionMode = "scene_based" | "multi_scene_single_video";

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
    breakdown: Array<{ line: string; units: number; unit_credits: number; subtotal: number }>;
  } | null;
};

type DistributionAccount = {
  id?: string;
  username?: string;
};

const NICHE_OPTIONS = ["fitness", "food", "travel", "business", "lifestyle"] as const;

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed" || status === "queued") return "default";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "ready" || status === "cancelling") return "secondary";
  if (status === "cancelled") return "outline";
  return "outline";
}

function StepIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "cancelled") return <Square className="h-4 w-4 text-muted-foreground" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-amber-600" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export default function GenerationStudioPage() {
  const [contentType, setContentType] = useState<ContentType>("reel");
  const [mode, setMode] = useState<Mode>("faceless");
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("multi_scene_single_video");
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

  const [editOpen, setEditOpen] = useState(false);
  const [editScene, setEditScene] = useState<JobScene | DraftScene | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [editDuration, setEditDuration] = useState(4);
  const [editRole, setEditRole] = useState<string>("motion");

  const [dragSceneId, setDragSceneId] = useState<string | null>(null);

  const fetchJob = useCallback(async (id: string) => {
    return api.generationJobs.get(id) as Promise<GenerationJobDetail>;
  }, []);

  const { data: job, mutate } = useSWR<GenerationJobDetail | undefined>(
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

  useEffect(() => {
    setOpenSceneVideoId(null);
  }, [jobId]);

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
        mode,
        niche,
        topic: topic.trim(),
      });
      setDraftScenes(plan);
      setJobId(null);
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
        video_duration: executionMode === "multi_scene_single_video" ? videoDuration : undefined,
      });
      setJobId(res.job_id);
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
              {executionMode === "multi_scene_single_video" ? (
                <div className="space-y-2">
                  <Label>Video duration (Seedance)</Label>
                  <Select value={String(videoDuration)} onValueChange={(v) => setVideoDuration(Number(v))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
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
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Seedance supports 4 to 15 seconds.</p>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Topic</Label>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. morning mobility routine" />
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
                  <p className="font-semibold text-foreground">Cost estimate (credits)</p>
                  <p className="mt-1 text-lg font-bold">{job.cost_estimate.total_credits}</p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {job.cost_estimate.breakdown.map((b) => (
                      <li key={b.line}>
                        {b.line}: {b.units} × {b.unit_credits} = {b.subtotal}
                      </li>
                    ))}
                  </ul>
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
              {sortedScenes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Create a draft job or run a stateless preview.</p>
              ) : (
                <>
                  <div className="flex h-24 w-full gap-1 rounded-lg border border-border bg-muted/20 p-2">
                    {sortedScenes.map((scene) => {
                      const w = Math.max(8, ((scene.duration || 3) / maxDur) * 100);
                      const sid = "id" in scene && scene.id ? scene.id : `draft-${scene.scene_index}`;
                      const meta = "metadata" in scene ? scene.metadata : undefined;
                      const thumb = meta?.preview_image_url;
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
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt="" src={thumb} className="h-10 w-full object-cover" />
                          ) : (
                            <div className="h-10 w-full bg-muted" />
                          )}
                          <div className="flex flex-1 flex-col justify-end p-1">
                            <span className="text-[9px] text-muted-foreground">{scene.duration}s</span>
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
                          <p className="text-sm leading-relaxed">{scene.prompt}</p>
                          {videoSrc ? (
                            <div
                              className={cn(
                                "video-container mt-3 overflow-hidden rounded-lg border border-border/50 bg-muted/20 shadow-md shadow-black/[0.07] ring-1 ring-black/[0.04] transition-[max-height,opacity] duration-300 ease-in-out dark:bg-muted/10 dark:shadow-black/40 dark:ring-white/[0.06]",
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
              {!jobId || !job ? (
                <p className="text-sm text-muted-foreground">Create a draft job to inspect status, cost, and steps.</p>
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

                  {job.output_url ? (
                    <div className="overflow-hidden rounded-md border bg-black">
                      <video
                        key={job.output_url}
                        src={job.output_url}
                        className="aspect-[9/16] max-h-[320px] w-full object-contain"
                        controls
                        playsInline
                      />
                    </div>
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-md border border-dashed px-3 text-center text-xs text-muted-foreground">
                      {jobIsCancelled
                        ? "Job was cancelled. Partial scene media is preserved; no final assembly was run."
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
                              <StepIcon status={s.status} />
                              <div className="min-w-0">
                                <p className="font-medium leading-none">{s.step_name}</p>
                                <p className="text-xs text-muted-foreground">{s.progress}%</p>
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
      </div>

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
