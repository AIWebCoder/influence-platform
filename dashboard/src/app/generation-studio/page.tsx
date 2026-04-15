"use client";

import { useCallback, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Circle, GripVertical, Loader2, RefreshCw, Rocket, Video, XCircle } from "lucide-react";
import toast from "react-hot-toast";

type ContentType = "post" | "reel" | "story";
type Mode = "persona" | "faceless";

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

const NICHE_OPTIONS = ["fitness", "food", "travel", "business", "lifestyle"] as const;

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed" || status === "queued") return "default";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "ready") return "secondary";
  return "outline";
}

function StepIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-amber-600" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export default function GenerationStudioPage() {
  const [contentType, setContentType] = useState<ContentType>("reel");
  const [mode, setMode] = useState<Mode>("faceless");
  const [niche, setNiche] = useState<string>("fitness");
  const [topic, setTopic] = useState("");
  const [accounts, setAccounts] = useState("bot_1, bot_2");
  const [schedule, setSchedule] = useState<Date | undefined>(undefined);
  const [draftScenes, setDraftScenes] = useState<DraftScene[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [launchLoading, setLaunchLoading] = useState(false);
  const [readyLoading, setReadyLoading] = useState(false);
  const [previewingSceneId, setPreviewingSceneId] = useState<string | null>(null);

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
    { refreshInterval: jobId ? 3000 : 0 }
  );

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

  const canLaunch = job && (job.status === "draft" || job.status === "ready");
  const pipelineActive = job && job.status === "running";

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
    const tAccounts = accounts.split(",").map((a) => a.trim()).filter(Boolean);
    if (!topic.trim() || tAccounts.length === 0) {
      toast.error("Topic and at least one account are required.");
      return;
    }
    setCreateLoading(true);
    try {
      const res = await api.generationJobs.create({
        content_type: contentType,
        mode,
        niche,
        topic: topic.trim(),
        target_accounts: tAccounts,
        scheduled_at: schedule ? schedule.toISOString() : undefined,
      });
      setJobId(res.job_id);
      toast.success("Draft job created with scenes. Edit, preview, then launch.");
    } catch {
      toast.error("Could not create draft job.");
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
    setPreviewingSceneId(sceneId);
    try {
      await api.generationJobs.previewScene(jobId, sceneId, kind);
      await mutate();
      toast.success(kind === "video" ? "Video preview generated." : "Image preview generated.");
    } catch {
      toast.error("Preview generation failed.");
    } finally {
      setPreviewingSceneId(null);
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
              <div className="space-y-2">
                <Label>Topic</Label>
                <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. morning mobility routine" />
              </div>
              <div className="space-y-2">
                <Label>Accounts</Label>
                <Input value={accounts} onChange={(e) => setAccounts(e.target.value)} placeholder="comma-separated usernames" />
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
                <p className="text-xs text-muted-foreground">
                  Job <span className="font-mono">{jobId.slice(0, 8)}…</span>
                  {job ? ` · ${job.status}` : ""}
                </p>
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
                          draggable
                          onDragStart={() => setDragSceneId(sid)}
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
                                    disabled={previewingSceneId === sid}
                                    onClick={() => handleSceneMediaPreview(sid, "image")}
                                  >
                                    {previewingSceneId === sid ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                                    Img preview
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={previewingSceneId === sid}
                                    onClick={() => handleSceneMediaPreview(sid, "video")}
                                  >
                                    Vid preview
                                  </Button>
                                </>
                              ) : null}
                              <Button size="sm" variant="outline" onClick={() => openEdit(scene)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => regenerateScene(scene)}>
                                Retry media
                              </Button>
                            </div>
                          </div>
                          <p className="text-sm leading-relaxed">{scene.prompt}</p>
                          {meta?.preview_video_url ? (
                            <video src={meta.preview_video_url} className="mt-2 max-h-32 w-full rounded border" controls playsInline />
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
                {pipelineActive || (job && job.status === "completed") ? "Polling every 3s." : "Polling while a job id is set."}
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
                    <Badge variant={statusBadgeVariant(job.status)}>{job.status}</Badge>
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
                    <div className="flex aspect-video items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
                      Final video appears when assembly completes.
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
                      {job.steps.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                        >
                          <div className="flex items-start gap-2">
                            <StepIcon status={s.status} />
                            <div>
                              <p className="font-medium leading-none">{s.step_name}</p>
                              <p className="text-xs text-muted-foreground">{s.progress}%</p>
                              {s.status === "failed" && s.error_message ? (
                                <p className="mt-1 text-xs text-red-600">{s.error_message}</p>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="shrink-0"
                            disabled={job.status === "draft" || job.status === "ready"}
                            onClick={() => retryStep(s.step_name)}
                          >
                            Retry
                          </Button>
                        </div>
                      ))}
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
