"use client";

import { Copy } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { Publication, PublicationDiagnostics } from "@/lib/publication-types";

type DetailLabels = {
  dash: string;
  status: string;
  retries: string;
  attemptLabel: string;
  maxRetriesLabel: string;
  sectionError: string;
  sectionTimeline: string;
  sectionIds: string;
  sectionContent: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  nextRetry: string;
  copyError: string;
  copyId: string;
  copied: string;
};

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm text-foreground break-words">{value}</div>
    </div>
  );
}

function copyText(value: string, successMessage: string) {
  void navigator.clipboard.writeText(value).then(
    () => toast.success(successMessage),
    () => toast.error("Copy failed"),
  );
}

export function PublicationDetailBody({
  publication,
  diagnostics,
  loading,
  error,
  labels,
  formatDate,
}: {
  publication: Publication | null;
  diagnostics: PublicationDiagnostics | null;
  loading: boolean;
  error: string | null;
  labels: DetailLabels;
  formatDate: (dateStr: string | null) => string;
}) {
  if (loading && !diagnostics) {
    return (
      <div className="space-y-4 py-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive py-4">{error}</p>;
  }

  const row = publication;
  const diag = diagnostics;
  if (!row && !diag) return null;

  const errorMessage = diag?.error_message ?? row?.error_message;
  const failureType = diag?.failure_type ?? row?.failure_type;
  const caption = diag?.content_caption ?? row?.content_caption;
  const jobId = diag?.generation_job_id ?? row?.generation_job_id;
  const publicationId = diag?.id ?? row?.id;

  return (
    <div className="space-y-5 py-2">
      {errorMessage ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{labels.sectionError}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => copyText(errorMessage, labels.copyError)}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {labels.copyError}
            </Button>
          </div>
          <pre className="max-h-40 overflow-auto rounded-md border bg-muted/40 p-3 text-xs text-destructive whitespace-pre-wrap break-words">
            {errorMessage}
          </pre>
          {failureType ? (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{failureType}</p>
          ) : null}
        </section>
      ) : null}

      {caption ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{labels.sectionContent}</h3>
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{caption}</p>
          {row?.content_type || diag?.content_type ? (
            <p className="text-xs text-muted-foreground">
              {diag?.content_type ?? row?.content_type}
              {(diag?.content_niche ?? row?.content_niche)
                ? ` · ${diag?.content_niche ?? row?.content_niche}`
                : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      <Separator />

      <section className="grid gap-3 sm:grid-cols-2">
        <FieldRow
          label={labels.retries}
          value={
            diag
              ? `${diag.retry_count} / ${diag.max_retries} (${labels.attemptLabel} ${diag.attempt})`
              : row
                ? `${row.retry_count} / ${row.max_retries || 3}`
                : labels.dash
          }
        />
        <FieldRow
          label={labels.status}
          value={diag?.status ?? row?.status ?? labels.dash}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{labels.sectionTimeline}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow label={labels.createdAt} value={formatDate(diag?.created_at ?? row?.created_at ?? null)} />
          <FieldRow label={labels.updatedAt} value={formatDate(diag?.updated_at ?? row?.updated_at ?? null)} />
          <FieldRow
            label={labels.publishedAt}
            value={formatDate(diag?.published_at ?? row?.published_at ?? null)}
          />
          {diag?.next_retry_at || row?.next_retry_at ? (
            <FieldRow
              label={labels.nextRetry}
              value={formatDate(diag?.next_retry_at ?? row?.next_retry_at ?? null)}
            />
          ) : null}
        </div>
      </section>

      <Separator />

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{labels.sectionIds}</h3>
          {publicationId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0"
              onClick={() => copyText(publicationId, labels.copied)}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              {labels.copyId}
            </Button>
          ) : null}
        </div>
        <dl className="space-y-2 font-mono text-[11px] text-muted-foreground">
          <div>
            <dt className="text-[10px] uppercase">publication_id</dt>
            <dd className="break-all text-foreground">{publicationId ?? labels.dash}</dd>
          </div>
          {jobId ? (
            <div>
              <dt className="text-[10px] uppercase">generation_job_id</dt>
              <dd className="break-all text-foreground">{jobId}</dd>
            </div>
          ) : null}
          {diag?.account_id ? (
            <div>
              <dt className="text-[10px] uppercase">account_id</dt>
              <dd className="break-all text-foreground">{diag.account_id}</dd>
            </div>
          ) : null}
          {row?.publication_target_id ? (
            <div>
              <dt className="text-[10px] uppercase">publication_target_id</dt>
              <dd className="break-all text-foreground">{row.publication_target_id}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
