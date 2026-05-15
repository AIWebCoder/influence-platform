/**
 * Operator-friendly messages for Content Factory / provider failures.
 */
export function humanizeGenerationMessage(message: string): string {
  const raw = message.trim();
  if (!raw) return message;
  const lower = raw.toLowerCase();

  if (
    lower.includes("no_ailiveai") ||
    lower.includes("ailiveai_api_key") ||
    lower.includes("ailiveai_api_token")
  ) {
    return "AliveAI API key is missing. Set AILIVEAI_API_KEY or AILIVEAI_API_TOKEN on the Content Factory service.";
  }
  if (lower.includes("kie_api_key") || lower.includes("no_api_key")) {
    return "Kie.ai API key is missing. Set KIE_API_KEY on the Content Factory service.";
  }
  if (
    lower.includes("no text model provider") ||
    lower.includes("anthropic_api_key") ||
    lower.includes("gemini_api_key") ||
    lower.includes("provider rejected api key")
  ) {
    return raw;
  }
  if (
    lower.includes("quota") ||
    lower.includes("credit balance") ||
    lower.includes("rate limit") ||
    lower.includes("resourceexhausted") ||
    lower.includes("429")
  ) {
    return "Text or media provider quota/credits are exhausted. Top up API credits and retry.";
  }
  if (lower.includes("success_no_urls") || lower.includes("no_task_id")) {
    return "Video provider returned no output URL. Retry the step or check Kie/AliveAI job status.";
  }
  if (
    lower.includes("localhost") ||
    lower.includes("not publicly accessible") ||
    lower.includes("public media") ||
    ((lower.includes("media url") || lower.includes("video url")) && !lower.includes("https://"))
  ) {
    return "Media must be available at a public HTTPS URL (not localhost). Check storage/CDN settings and regenerate assets.";
  }
  if (lower.includes("partial_images") || lower.includes("missing_video")) {
    return "Scene media is incomplete (missing image or video). Retry the failed scene from the timeline.";
  }

  return raw;
}

type PipelineStep = {
  step_name: string;
  status: string;
  error_message?: string | null;
};

type PipelineScene = {
  scene_index: number;
  status: string;
  error_message?: string | null;
};

export function summarizeJobPipelineErrors(job: {
  steps?: PipelineStep[];
  scenes?: PipelineScene[];
}): string | null {
  const parts: string[] = [];

  for (const step of job.steps ?? []) {
    if (step.status === "failed" && step.error_message?.trim()) {
      parts.push(`${step.step_name}: ${humanizeGenerationMessage(step.error_message)}`);
    }
  }
  for (const scene of job.scenes ?? []) {
    if (scene.status === "failed" && scene.error_message?.trim()) {
      parts.push(`Scene ${scene.scene_index + 1}: ${humanizeGenerationMessage(scene.error_message)}`);
    }
  }

  if (parts.length === 0) return null;
  const joined = parts.slice(0, 3).join(" - ");
  return parts.length > 3 ? `${joined} - ...` : joined;
}