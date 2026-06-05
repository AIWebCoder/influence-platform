/** Job is actively generating — must cancel before delete/abandon. */
const ACTIVE_GENERATION_STATUSES = new Set(["running", "pending", "cancelling"]);

export function canAbandonGenerationJob(status: string | undefined | null): boolean {
  if (!status) return false;
  return !ACTIVE_GENERATION_STATUSES.has(status);
}