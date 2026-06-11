"use client";

import { AppStepper } from "@/components/platform/AppStepper";
import {
  STUDIO_USER_WORKFLOW_PHASES,
  studioUserWorkflowPhaseIndex,
  type StudioUserWorkflowPhase,
} from "@/lib/generation-studio-workflow";
import { deriveStepStatus } from "@/lib/platform/stepper";

export type WorkflowStepLabels = {
  configure: string;
  generate: string;
  review: string;
  publish: string;
  configureHint: string;
  generateHint: string;
  reviewHint: string;
  publishHint: string;
};

export function GenerationStudioWorkflowBar({
  phase,
  labels,
  nextHint,
}: {
  phase: StudioUserWorkflowPhase;
  labels: WorkflowStepLabels;
  nextHint?: string | null;
}) {
  const activeIndex = studioUserWorkflowPhaseIndex(phase);

  const stepHint = (key: StudioUserWorkflowPhase) => {
    switch (key) {
      case "configure":
        return labels.configureHint;
      case "generate":
        return labels.generateHint;
      case "review":
        return labels.reviewHint;
      case "publish":
        return labels.publishHint;
    }
  };

  const steps = STUDIO_USER_WORKFLOW_PHASES.map((key, index) => ({
    id: key,
    label: labels[key],
    hint: stepHint(key),
    status: deriveStepStatus(index, activeIndex),
  }));

  return (
    <AppStepper steps={steps} nextHint={nextHint} aria-label={labels.configure} />
  );
}
