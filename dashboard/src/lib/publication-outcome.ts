/** User-facing publication outcome derived from API responses. */

export type PublishIntentTarget = {
  account_id: string;
  platform: string;
  status: string;
};

export type PublishIntentResponse = {
  intent_id: string;
  status: string;
  targets: PublishIntentTarget[];
};

export type PublicationOutcomeVariant = "success" | "queued" | "partial_failure" | "failure";

export type PublicationOutcomeAction = "post_now" | "create_intent" | "save_draft" | "schedule";

export type PublicationOutcome = {
  variant: PublicationOutcomeVariant;
  intent: PublishIntentResponse;
  action: PublicationOutcomeAction;
  dispatched: boolean;
  dispatchCount?: number;
  errorMessage?: string;
};

const FAILED_TARGET_STATUSES = new Set(["failed", "uncertain"]);
const OK_TARGET_STATUSES = new Set(["pending", "publishing", "published", "queued"]);
const IN_FLIGHT_TARGET_STATUSES = new Set(["pending", "publishing", "queued"]);

function normalizeStatus(value: string): string {
  return String(value || "").trim().toLowerCase();
}

export function summarizePublishTargets(targets: Array<{ status: string }>): {
  allFailed: boolean;
  allPublished: boolean;
  anyInFlight: boolean;
} {
  const statuses = targets.map((t) => normalizeStatus(t.status));
  if (statuses.length === 0) {
    return { allFailed: false, allPublished: false, anyInFlight: false };
  }
  return {
    allFailed: statuses.every((s) => FAILED_TARGET_STATUSES.has(s)),
    allPublished: statuses.every((s) => s === "published"),
    anyInFlight: statuses.some((s) => IN_FLIGHT_TARGET_STATUSES.has(s)),
  };
}

export function isPublicationOutcomeTerminal(outcome: PublicationOutcome): boolean {
  if (outcome.errorMessage) return true;
  if (outcome.variant === "failure") return true;

  const intentStatus = normalizeStatus(outcome.intent.status);
  const targets = outcome.intent.targets ?? [];
  const summary = summarizePublishTargets(targets);

  if (intentStatus === "published" || summary.allPublished) return true;
  if (intentStatus === "failed" || summary.allFailed) return true;

  if (outcome.variant === "partial_failure" && !summary.anyInFlight) return true;

  return false;
}

export function resolvePublicationOutcome(input: {
  intent: PublishIntentResponse;
  action: PublicationOutcomeAction;
  dispatched: boolean;
  dispatchCount?: number;
  errorMessage?: string;
}): PublicationOutcome {
  const { intent, action, dispatched, dispatchCount, errorMessage } = input;
  const intentStatus = normalizeStatus(intent.status);
  const targets = intent.targets ?? [];
  const summary = summarizePublishTargets(targets);

  if (errorMessage) {
    return {
      variant: "failure",
      intent,
      action,
      dispatched,
      dispatchCount,
      errorMessage,
    };
  }

  const failed = targets.filter((t) => FAILED_TARGET_STATUSES.has(normalizeStatus(t.status)));
  const ok = targets.filter((t) => OK_TARGET_STATUSES.has(normalizeStatus(t.status)));

  const allTargetsFailed =
    targets.length > 0 && failed.length === targets.length && ok.length === 0;

  if (intentStatus === "failed" || allTargetsFailed) {
    return { variant: "failure", intent, action, dispatched, dispatchCount };
  }

  if (failed.length > 0 && ok.length > 0) {
    return { variant: "partial_failure", intent, action, dispatched, dispatchCount };
  }

  if (summary.allPublished || intentStatus === "published") {
    return { variant: "success", intent, action, dispatched, dispatchCount };
  }

  if (
    action === "save_draft" ||
    intentStatus === "draft" ||
    action === "schedule" ||
    (!dispatched && action !== "post_now")
  ) {
    return { variant: "queued", intent, action, dispatched, dispatchCount };
  }

  if (
    dispatched &&
    (intentStatus === "queued" || summary.anyInFlight || intentStatus === "partial_failed")
  ) {
    return { variant: "queued", intent, action, dispatched, dispatchCount };
  }

  return { variant: "queued", intent, action, dispatched, dispatchCount };
}
