const STORAGE_KEY = "influence-tracked-generation-jobs";
const MAX_TRACKED = 5;

export const TRACKING_CHANGED_EVENT = "influence-tracked-generation-jobs-changed";

export function getTrackedGenerationJobIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is string => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x))
      .slice(0, MAX_TRACKED);
  } catch {
    return [];
  }
}

export function addTrackedGenerationJobId(jobId: string): void {
  if (typeof window === "undefined" || !jobId) return;
  const trimmed = jobId.trim();
  if (!/^[0-9a-f-]{36}$/i.test(trimmed)) return;
  const ids = getTrackedGenerationJobIds().filter((id) => id !== trimmed);
  const next = [trimmed, ...ids].slice(0, MAX_TRACKED);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(TRACKING_CHANGED_EVENT));
}

export function removeTrackedGenerationJobId(jobId: string): void {
  if (typeof window === "undefined" || !jobId) return;
  const trimmed = jobId.trim();
  const next = getTrackedGenerationJobIds().filter((id) => id !== trimmed);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(TRACKING_CHANGED_EVENT));
}
