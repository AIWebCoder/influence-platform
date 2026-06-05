/** Presentation layer for generation job progress (honest phases + estimated %). */

export type JobStepLike = {
  step_name: string;
  status: string;
  progress: number;
  metadata?: Record<string, unknown>;
};

export type JobProgressInput = {
  status: string;
  progress: number;
  execution_mode?: string | null;
  steps?: JobStepLike[];
};

export type JobProgressLabels = {
  phaseDraft: string;
  phaseReady: string;
  phaseStarting: string;
  phaseSceneGen: string;
  phaseImages: string;
  phasePhoto: string;
  phaseVideo: string;
  phaseVideoMotion: string;
  phaseVideoBolt: string;
  phaseAssembly: string;
  phaseFinalizing: string;
  phaseDone: string;
  phaseFailed: string;
  phaseCancelled: string;
  phaseCancelling: string;
  scenesProgress: string;
  providerWait: string;
  estimatedHint: string;
  elapsed: string;
};

export type JobProgressPresentation = {
  phaseLabel: string;
  detailLine: string | null;
  barMode: "none" | "indeterminate" | "determinate";
  barValue: number;
  showPercent: boolean;
  percentLabel: string | null;
  etaHint: string | null;
};

const SINGLE_CLIP = new Set(["multi_scene_single_video", "ailiveai_single_video"]);
const PHOTO_MODES = new Set(["single_image"]);

function activeStep(job: JobProgressInput): JobStepLike | undefined {
  const steps = job.steps ?? [];
  return (
    steps.find((s) => s.status === "running") ??
    steps.find((s) => s.status === "pending" && job.status === "running")
  );
}

function stepByName(job: JobProgressInput, name: string): JobStepLike | undefined {
  return (job.steps ?? []).find((s) => s.step_name === name);
}

function formatScenes(done: number, total: number, template: string): string {
  return template.replace("{done}", String(done)).replace("{total}", String(total));
}

export function resolveJobProgressPresentation(
  job: JobProgressInput,
  labels: JobProgressLabels,
  locale: string
): JobProgressPresentation {
  const mode = (job.execution_mode || "scene_based").trim();
  const status = job.status;
  const running = activeStep(job);
  const videoStep = stepByName(job, "video_generation");

  if (status === "draft") {
    return {
      phaseLabel: labels.phaseDraft,
      detailLine: null,
      barMode: "none",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }
  if (status === "ready") {
    return {
      phaseLabel: labels.phaseReady,
      detailLine: null,
      barMode: "none",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }
  if (status === "cancelling") {
    return {
      phaseLabel: labels.phaseCancelling,
      detailLine: null,
      barMode: "indeterminate",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }
  if (status === "cancelled") {
    return {
      phaseLabel: labels.phaseCancelled,
      detailLine: null,
      barMode: "none",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }
  if (status === "failed") {
    return {
      phaseLabel: labels.phaseFailed,
      detailLine: null,
      barMode: "none",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }
  if (status === "completed") {
    return {
      phaseLabel: labels.phaseDone,
      detailLine: null,
      barMode: "determinate",
      barValue: 100,
      showPercent: true,
      percentLabel: "100%",
      etaHint: null,
    };
  }

  if (running?.step_name === "distribution" || (videoStep?.status === "completed" && status === "running")) {
    const fin = running?.step_name === "distribution";
    return {
      phaseLabel: fin ? labels.phaseFinalizing : labels.phaseDone,
      detailLine: null,
      barMode: "determinate",
      barValue: Math.min(99, Math.max(job.progress, 92)),
      showPercent: true,
      percentLabel: `${Math.min(99, Math.max(job.progress, 92))}%`,
      etaHint: null,
    };
  }

  const imageStep = stepByName(job, "image_generation");
  if (
    PHOTO_MODES.has(mode) &&
    (imageStep?.status === "completed" || running?.step_name === "distribution") &&
    status === "running"
  ) {
    const fin = running?.step_name === "distribution";
    return {
      phaseLabel: fin ? labels.phaseFinalizing : labels.phaseDone,
      detailLine: null,
      barMode: "determinate",
      barValue: Math.min(99, Math.max(job.progress, 92)),
      showPercent: true,
      percentLabel: `${Math.min(99, Math.max(job.progress, 92))}%`,
      etaHint: null,
    };
  }

  if (running) {
    const meta = running.metadata ?? {};
    const pollAttempt = meta.provider_poll_attempt as number | undefined;
    const pollMax = meta.provider_poll_max as number | undefined;
    const scenesDone = meta.video_scenes_completed as number | undefined;
    const scenesTotal = meta.video_scenes_total as number | undefined;

    let phaseLabel = labels.phaseStarting;
    if (running.step_name === "scene_generation") phaseLabel = labels.phaseSceneGen;
    else if (running.step_name === "image_generation") {
      phaseLabel = PHOTO_MODES.has(mode) ? labels.phasePhoto : labels.phaseImages;
    } else if (running.step_name === "video_generation") {
      if (mode === "multi_scene_single_video") phaseLabel = labels.phaseVideoMotion;
      else if (mode === "ailiveai_single_video") phaseLabel = labels.phaseVideoBolt;
      else phaseLabel = labels.phaseVideo;
    } else if (running.step_name === "assembly") phaseLabel = labels.phaseAssembly;

    let detailLine: string | null = null;
    if (
      typeof scenesDone === "number" &&
      typeof scenesTotal === "number" &&
      scenesTotal > 0 &&
      mode === "scene_based"
    ) {
      detailLine = formatScenes(scenesDone, scenesTotal, labels.scenesProgress);
    } else if (typeof pollAttempt === "number" && typeof pollMax === "number" && pollMax > 0) {
      detailLine = labels.providerWait
        .replace("{current}", String(pollAttempt))
        .replace("{max}", String(pollMax));
    }

    const barValue = Math.min(99, Math.max(8, job.progress));
    const isProviderPoll =
      SINGLE_CLIP.has(mode) &&
      running.step_name === "video_generation" &&
      typeof pollAttempt === "number" &&
      pollAttempt < (pollMax ?? 999);

    let etaHint: string | null = null;
    if (running.step_name === "video_generation") {
      if (mode === "multi_scene_single_video") {
        etaHint = locale === "fr" ? "En general 3-12 min" : "Usually 3-12 min";
      } else if (mode === "ailiveai_single_video") {
        etaHint = locale === "fr" ? "En general 5-10 min" : "Usually 5-10 min";
      }
    }

    return {
      phaseLabel,
      detailLine,
      barMode: isProviderPoll && barValue < 15 ? "indeterminate" : "determinate",
      barValue,
      showPercent: true,
      percentLabel: `${barValue}%`,
      etaHint: etaHint ? `${labels.estimatedHint} - ${etaHint}` : labels.estimatedHint,
    };
  }

  if (status === "running" && PHOTO_MODES.has(mode) && job.progress >= 8 && job.progress < 95) {
    const barValue = Math.min(99, Math.max(job.progress, 8));
    return {
      phaseLabel: labels.phasePhoto,
      detailLine: null,
      barMode: barValue < 14 ? "indeterminate" : "determinate",
      barValue,
      showPercent: true,
      percentLabel: `${barValue}%`,
      etaHint:
        locale === "fr"
          ? `${labels.estimatedHint} - En general 1-3 min`
          : `${labels.estimatedHint} - Usually 1-3 min`,
    };
  }

  if (status === "running" && SINGLE_CLIP.has(mode) && job.progress >= 10 && job.progress < 95) {
    const phaseLabel =
      mode === "ailiveai_single_video" ? labels.phaseVideoBolt : labels.phaseVideoMotion;
    const barValue = Math.min(99, Math.max(job.progress, 10));
    return {
      phaseLabel,
      detailLine: null,
      barMode: barValue < 14 ? "indeterminate" : "determinate",
      barValue,
      showPercent: true,
      percentLabel: `${barValue}%`,
      etaHint:
        mode === "multi_scene_single_video"
          ? `${labels.estimatedHint} - ${locale === "fr" ? "En general 3-12 min" : "Usually 3-12 min"}`
          : `${labels.estimatedHint} - ${locale === "fr" ? "En general 5-10 min" : "Usually 5-10 min"}`,
    };
  }

  return {
    phaseLabel: labels.phaseStarting,
    detailLine: null,
    barMode: job.progress > 0 ? "determinate" : "indeterminate",
    barValue: Math.min(99, Math.max(job.progress, 10)),
    showPercent: job.progress > 0,
    percentLabel: job.progress > 0 ? `${job.progress}%` : null,
    etaHint: labels.estimatedHint,
  };
}

export function formatJobElapsed(
  startedAtIso: string | undefined | null,
  locale: string
): string | null {
  if (!startedAtIso) return null;
  const started = Date.parse(startedAtIso);
  if (Number.isNaN(started)) return null;
  const sec = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return locale === "fr" ? `${m} min ${pad(s)} s` : `${m}m ${pad(s)}s`;
}

export function videoGenerationStartedAt(job: JobProgressInput): string | undefined {
  const step = stepByName(job, "video_generation");
  const raw = step?.metadata?.execution_started_at;
  return typeof raw === "string" ? raw : undefined;
}
