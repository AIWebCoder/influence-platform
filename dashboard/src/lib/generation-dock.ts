/** Presentation helpers for the tracked-generation-jobs floating dock. */

import {
  resolveJobProgressPresentation,
  type JobProgressInput,
  type JobProgressLabels,
  type JobProgressPresentation,
  type JobStepLike,
} from "@/lib/generation-job-progress";
import { summarizePublishTargets } from "@/lib/publication-outcome";

export type TrackedJobEnrich = {
  topic?: string | null;
  caption?: string | null;
  queue_display_title?: string | null;
  publish_intent_id?: string | null;
  publish_intent_status?: string | null;
};

export type DockPublishSnapshot = {
  intentStatus: string;
  targets: Array<{ status: string }>;
};

export type TrackedJobSnapshot = {
  id: string;
  status: string;
  progress: number;
  execution_mode?: string;
  input_payload?: Record<string, unknown>;
  steps?: JobStepLike[];
  created_at?: string | null;
  updated_at?: string | null;
  title: string;
  publish_intent_id?: string | null;
  publish_intent_status?: string | null;
  publish_snapshot?: DockPublishSnapshot | null;
};

export type DockProgressLabels = JobProgressLabels & {
  phaseReadyToPublish: string;
  phasePublished: string;
  phasePublishing: string;
  phasePublishFailed: string;
};

export type DockTimeLabels = {
  justNow: string;
  secAgo: string;
  minAgo: string;
  hrAgo: string;
  dayAgo: string;
  startedAgo: string;
  updatedAgo: string;
  completedAgo: string;
};

const LIVE_STATUSES = new Set(["running", "pending", "cancelling"]);

export function isDockJobLive(status: string): boolean {
  return LIVE_STATUSES.has(status) || status === "draft" || status === "ready";
}

function truncateTitle(value: string, max = 52): string {
  const t = value.replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function normalizeIntent(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function resolveCompletedPublishPresentation(
  base: JobProgressPresentation,
  labels: DockProgressLabels,
  intentStatus: string,
  targets: Array<{ status: string }>,
): JobProgressPresentation {
  const intent = normalizeIntent(intentStatus);
  const summary = summarizePublishTargets(targets);

  if (summary.allFailed || intent === "failed") {
    return {
      ...base,
      phaseLabel: labels.phasePublishFailed,
      detailLine: null,
      barMode: "none",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }

  if (summary.allPublished || intent === "published") {
    return {
      ...base,
      phaseLabel: labels.phasePublished,
      detailLine: null,
      barMode: "none",
      barValue: 100,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }

  if (summary.anyInFlight || intent === "queued" || intent === "partial_failed") {
    return {
      ...base,
      phaseLabel: labels.phasePublishing,
      detailLine: null,
      barMode: "indeterminate",
      barValue: 100,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }

  return {
    ...base,
    phaseLabel: labels.phaseReadyToPublish,
    detailLine: null,
    barMode: "none",
    barValue: 100,
    showPercent: false,
    percentLabel: null,
    etaHint: null,
  };
}

export function resolveTrackedJobTitle(
  job: {
    id: string;
    input_payload?: Record<string, unknown>;
    queue_display_title?: string | null;
    caption?: string | null;
    topic?: string | null;
  },
  fallbackLabel: string,
): string {
  if (job.queue_display_title?.trim()) {
    return truncateTitle(job.queue_display_title);
  }
  if (job.caption?.trim()) return truncateTitle(job.caption);
  if (job.topic?.trim()) return truncateTitle(job.topic);
  const payload = job.input_payload ?? {};
  const cap = String(payload.caption ?? "").trim();
  if (cap) return truncateTitle(cap);
  const topic = String(payload.topic ?? "").trim();
  if (topic) return truncateTitle(topic);
  const niche = String(payload.niche ?? "").trim();
  if (niche) return truncateTitle(niche);
  return fallbackLabel.replace("{id}", job.id.slice(0, 8));
}

export function resolveDockJobPresentation(
  job: JobProgressInput & {
    publish_intent_status?: string | null;
    publish_snapshot?: DockPublishSnapshot | null;
  },
  labels: DockProgressLabels,
  locale: string,
): JobProgressPresentation {
  const base = resolveJobProgressPresentation(job, labels, locale);

  if (job.status === "completed") {
    if (job.publish_snapshot?.targets?.length) {
      return resolveCompletedPublishPresentation(
        base,
        labels,
        job.publish_snapshot.intentStatus,
        job.publish_snapshot.targets,
      );
    }

    const intent = normalizeIntent(job.publish_intent_status);
    if (intent === "published") {
      return {
        ...base,
        phaseLabel: labels.phasePublished,
        detailLine: null,
        barMode: "none",
        barValue: 100,
        showPercent: false,
        percentLabel: null,
        etaHint: null,
      };
    }
    if (intent === "failed") {
      return {
        ...base,
        phaseLabel: labels.phasePublishFailed,
        detailLine: null,
        barMode: "none",
        barValue: 0,
        showPercent: false,
        percentLabel: null,
        etaHint: null,
      };
    }
    if (intent === "queued" || intent === "partial_failed") {
      return {
        ...base,
        phaseLabel: labels.phasePublishing,
        detailLine: null,
        barMode: "indeterminate",
        barValue: 100,
        showPercent: false,
        percentLabel: null,
        etaHint: null,
      };
    }
    return {
      ...base,
      phaseLabel: labels.phaseReadyToPublish,
      detailLine: null,
      barMode: "none",
      barValue: 100,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }

  if (job.status === "ready") {
    return {
      ...base,
      phaseLabel: labels.phaseReadyToPublish,
      detailLine: null,
      barMode: "none",
      barValue: 0,
      showPercent: false,
      percentLabel: null,
      etaHint: null,
    };
  }

  return base;
}

export function dockStatusTone(
  status: string,
  _phaseLabel: string,
  publish?: {
    intentStatus?: string | null;
    targets?: Array<{ status: string }>;
  } | null,
): "live" | "success" | "publish" | "failed" | "muted" {
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "cancelling") return "muted";

  if (status === "completed" && publish?.targets?.length) {
    const summary = summarizePublishTargets(publish.targets);
    const intent = normalizeIntent(publish.intentStatus);
    if (summary.allFailed || intent === "failed") return "failed";
    if (summary.allPublished || intent === "published") return "publish";
    if (summary.anyInFlight || intent === "queued" || intent === "partial_failed") return "live";
    return "success";
  }

  const intent = normalizeIntent(publish?.intentStatus);
  if (status === "completed" && intent === "published") return "publish";
  if (status === "completed" && intent === "failed") return "failed";
  if (status === "completed" && (intent === "queued" || intent === "partial_failed")) return "live";
  if (status === "completed" || status === "ready") return "success";
  if (LIVE_STATUSES.has(status) || status === "draft") return "live";
  return "muted";
}

export function formatDockRelativeTime(
  iso: string | null | undefined,
  locale: string,
  labels: DockTimeLabels,
  context: "started" | "updated" | "completed",
): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;

  const diffSec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const prefix =
    context === "started"
      ? labels.startedAgo
      : context === "completed"
        ? labels.completedAgo
        : labels.updatedAgo;

  if (abs < 10) return `${prefix} ${labels.justNow}`;

  try {
    const rtf = new Intl.RelativeTimeFormat(locale === "fr" ? "fr" : "en", { numeric: "auto" });
    if (abs < 60) return `${prefix} ${rtf.format(diffSec, "second")}`;
    if (abs < 3600) return `${prefix} ${rtf.format(Math.round(diffSec / 60), "minute")}`;
    if (abs < 86400) return `${prefix} ${rtf.format(Math.round(diffSec / 3600), "hour")}`;
    return `${prefix} ${rtf.format(Math.round(diffSec / 86400), "day")}`;
  } catch {
    if (abs < 60) return `${prefix} ${labels.secAgo.replace("{n}", String(abs))}`;
    if (abs < 3600) return `${prefix} ${labels.minAgo.replace("{n}", String(Math.floor(abs / 60)))}`;
    if (abs < 86400) return `${prefix} ${labels.hrAgo.replace("{n}", String(Math.floor(abs / 3600)))}`;
    return `${prefix} ${labels.dayAgo.replace("{n}", String(Math.floor(abs / 86400)))}`;
  }
}

export function dockTimestampContext(status: string): "started" | "updated" | "completed" {
  if (status === "completed" || status === "failed" || status === "cancelled") return "completed";
  if (status === "draft" || status === "ready") return "started";
  return "updated";
}

export function dockProgressLine(presentation: JobProgressPresentation): string | null {
  if (presentation.showPercent && presentation.percentLabel && presentation.detailLine) {
    return `${presentation.percentLabel} · ${presentation.detailLine}`;
  }
  if (presentation.showPercent && presentation.percentLabel) {
    return presentation.percentLabel;
  }
  if (presentation.detailLine) return presentation.detailLine;
  return null;
}
