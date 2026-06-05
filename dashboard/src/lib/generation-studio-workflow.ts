/** Generation Studio workflow helpers (tab gating + user-facing steps). */

/** Internal phase used for publication tab unlock. */
export type StudioWorkflowPhase = "DRAFT" | "GENERATING" | "GENERATED" | "PUBLISHING" | "PUBLISHED";

export type StudioPublishActivity = "idle" | "intent" | "dispatched";

export type StudioTab = "creation" | "publication";

/** User-facing steps shown in the workflow bar. */
export type StudioUserWorkflowPhase = "configure" | "generate" | "review" | "publish";

export const STUDIO_USER_WORKFLOW_PHASES: StudioUserWorkflowPhase[] = [
  "configure",
  "generate",
  "review",
  "publish",
];

export function deriveStudioWorkflowPhase(
  jobStatus: string | undefined,
  publishActivity: StudioPublishActivity,
): StudioWorkflowPhase {
  if (publishActivity === "dispatched") return "PUBLISHING";
  if (publishActivity === "intent") return "GENERATED";

  const status = String(jobStatus ?? "").toLowerCase();
  if (status === "completed") return "GENERATED";
  if (status === "running" || status === "pending" || status === "cancelling") return "GENERATING";
  if (status === "draft" || status === "ready") return "DRAFT";
  return "DRAFT";
}

export function isPublicationTabUnlocked(phase: StudioWorkflowPhase): boolean {
  return phase === "GENERATED" || phase === "PUBLISHING" || phase === "PUBLISHED";
}

export function parseStudioTab(value: string | null): StudioTab {
  return value === "publication" ? "publication" : "creation";
}

export function resolveStudioUserWorkflowPhase(input: {
  studioTab: StudioTab;
  jobId: string | null;
  jobStatus?: string | null;
}): StudioUserWorkflowPhase {
  if (input.studioTab === "publication") return "publish";
  if (!input.jobId || !input.jobStatus) return "configure";

  const status = String(input.jobStatus).toLowerCase();
  if (status === "running" || status === "pending" || status === "cancelling") return "generate";
  if (status === "completed") return "review";
  if (status === "failed" || status === "cancelled" || status === "draft" || status === "ready") {
    return "generate";
  }
  return "configure";
}

export function studioUserWorkflowPhaseIndex(phase: StudioUserWorkflowPhase): number {
  return STUDIO_USER_WORKFLOW_PHASES.indexOf(phase);
}
