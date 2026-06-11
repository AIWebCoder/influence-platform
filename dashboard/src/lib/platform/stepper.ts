export type AppStepperStepStatus = "complete" | "current" | "upcoming";

export type AppStepperStep = {
  id: string;
  label: string;
  hint?: string;
  status: AppStepperStepStatus;
};

export function deriveStepStatus(index: number, activeIndex: number): AppStepperStepStatus {
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return "current";
  return "upcoming";
}

export function activeIndexFromFlags(
  steps: { done: boolean; active: boolean }[],
): number {
  const active = steps.findIndex((s) => s.active);
  if (active >= 0) return active;
  const firstIncomplete = steps.findIndex((s) => !s.done);
  return firstIncomplete >= 0 ? firstIncomplete : Math.max(0, steps.length - 1);
}

export function stepsFromWorkflow(
  items: { id: string; label: string; done: boolean; active: boolean; hint?: string }[],
): AppStepperStep[] {
  const activeIndex = activeIndexFromFlags(items);
  return items.map((item, index) => ({
    id: item.id,
    label: item.label,
    hint: item.hint,
    status: item.done ? "complete" : index === activeIndex ? "current" : "upcoming",
  }));
}
