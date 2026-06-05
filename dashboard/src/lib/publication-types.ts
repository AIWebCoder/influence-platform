/** Shared types for the Publications list and detail sheet. */

export type PublicationStatus =
  | "published"
  | "failed"
  | "permanently_failed"
  | "retrying"
  | "pending"
  | "publishing";

export interface Publication {
  id: string;
  content_id: string | null;
  publication_target_id?: string | null;
  generation_job_id?: string | null;
  status: PublicationStatus;
  post_url: string | null;
  published_at: string | null;
  error_message: string | null;
  retry_count: number;
  attempt?: number;
  failure_type: string | null;
  last_retry_at: string | null;
  next_retry_at?: string | null;
  max_retries: number;
  engagement_score: number | null;
  created_at: string;
  updated_at: string;
  account_username: string;
  account_platform: string;
  content_caption: string | null;
  content_type: string | null;
  content_niche: string | null;
}

export interface PublicationDiagnostics {
  id: string;
  status: string;
  error_message: string | null;
  failure_type: string | null;
  retry_count: number;
  max_retries: number;
  attempt: number;
  last_retry_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  post_url: string | null;
  account_id: string;
  account_username: string;
  content_id: string | null;
  generation_job_id?: string | null;
  content_type: string | null;
  content_niche: string | null;
  content_caption: string | null;
}

export function publicationFromDiagnostics(diag: PublicationDiagnostics): Publication {
  return {
    id: diag.id,
    content_id: diag.content_id,
    generation_job_id: diag.generation_job_id ?? null,
    status: diag.status as PublicationStatus,
    post_url: diag.post_url,
    published_at: diag.published_at,
    error_message: diag.error_message,
    retry_count: diag.retry_count,
    attempt: diag.attempt,
    failure_type: diag.failure_type,
    last_retry_at: diag.last_retry_at,
    next_retry_at: diag.next_retry_at,
    max_retries: diag.max_retries,
    engagement_score: null,
    created_at: diag.created_at,
    updated_at: diag.updated_at,
    account_username: diag.account_username,
    account_platform: "instagram",
    content_caption: diag.content_caption,
    content_type: diag.content_type,
    content_niche: diag.content_niche,
  };
}

export function canRetryPublication(item: Publication): boolean {
  if (!["failed", "permanently_failed", "retrying"].includes(item.status)) return false;
  if (item.publication_target_id) return true;
  return Number(item.retry_count || 0) < Number(item.max_retries || 3);
}
