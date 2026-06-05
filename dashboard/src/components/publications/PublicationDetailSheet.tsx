"use client";

import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RotateCw,
  XCircle,
  Zap,
} from "lucide-react";

import { PublicationDetailBody } from "@/components/publications/PublicationDetailBody";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { TranslationTree } from "@/lib/i18n";
import {
  canRetryPublication,
  type Publication,
  type PublicationDiagnostics,
  type PublicationStatus,
} from "@/lib/publication-types";
import { cn } from "@/lib/utils";

type PubText = TranslationTree["publications"];

function statusMeta(status: PublicationStatus, pub: PubText) {
  switch (status) {
    case "published":
      return { label: pub.published, variant: "default" as const, icon: CheckCircle2 };
    case "failed":
      return { label: pub.failed, variant: "destructive" as const, icon: XCircle };
    case "permanently_failed":
      return { label: pub.permDead, variant: "secondary" as const, icon: AlertCircle };
    case "retrying":
      return { label: pub.retrying, variant: "outline" as const, icon: RotateCw };
    case "publishing":
      return { label: pub.publishing, variant: "outline" as const, icon: Zap };
    default:
      return { label: pub.pending, variant: "secondary" as const, icon: Clock };
  }
}

export type PublicationDetailSheetProps = {
  publication: Publication | null;
  diagnostics: PublicationDiagnostics | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  notOnCurrentPage?: boolean;
  onRetry?: (publicationId: string) => void | Promise<void>;
  retrying?: boolean;
  formatDate: (dateStr: string | null) => string;
};

export function PublicationDetailSheet({
  publication,
  diagnostics,
  open,
  onOpenChange,
  loading,
  error,
  notOnCurrentPage = false,
  onRetry,
  retrying = false,
  formatDate,
}: PublicationDetailSheetProps) {
  const { text } = useLocale();
  const pub = text.publications;

  const row = publication;
  const status = (diagnostics?.status ?? row?.status ?? "pending") as PublicationStatus;
  const meta = statusMeta(status, pub);
  const StatusIcon = meta.icon;
  const username = diagnostics?.account_username ?? row?.account_username ?? pub.dash;
  const jobId = diagnostics?.generation_job_id ?? row?.generation_job_id;
  const postUrl = diagnostics?.post_url ?? row?.post_url;
  const publicationId = diagnostics?.id ?? row?.id;
  const showRetry = row ? canRetryPublication(row) : false;

  const detailLabels = {
    dash: pub.dash,
    status: pub.status,
    retries: pub.retries,
    attemptLabel: pub.attemptLabel,
    maxRetriesLabel: pub.maxRetriesLabel,
    sectionError: pub.sectionError,
    sectionTimeline: pub.sectionTimeline,
    sectionIds: pub.sectionIds,
    sectionContent: pub.content,
    createdAt: pub.createdAt,
    updatedAt: pub.updatedAt,
    publishedAt: pub.publishedAt,
    nextRetry: pub.nextRetryAt,
    copyError: pub.copyError,
    copyId: pub.copyId,
    copied: pub.copied,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="truncate">@{username}</span>
            <Badge variant={meta.variant} className="gap-1 shrink-0">
              <StatusIcon className="h-3.5 w-3.5" />
              {meta.label}
            </Badge>
          </SheetTitle>
          <SheetDescription>{pub.detailSubtitle}</SheetDescription>
        </SheetHeader>

        {notOnCurrentPage ? (
          <Alert className="mx-0 border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
            <AlertDescription className="text-sm">{pub.notOnCurrentPage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex-1 overflow-y-auto px-1">
          <PublicationDetailBody
            publication={publication}
            diagnostics={diagnostics}
            loading={loading}
            error={error}
            labels={detailLabels}
            formatDate={formatDate}
          />
        </div>

        <SheetFooter className="flex-col gap-2 border-t pt-4 sm:flex-col sm:space-x-0">
          {showRetry && publicationId && onRetry ? (
            <Button
              type="button"
              className="w-full"
              disabled={retrying}
              onClick={() => void onRetry(publicationId)}
            >
              {retrying ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="mr-2 h-4 w-4" />
              )}
              {retrying ? pub.retryingAction : pub.retry}
            </Button>
          ) : null}
          {jobId ? (
            <Button type="button" variant="secondary" className="w-full" asChild>
              <Link href={`/generation-studio?job=${encodeURIComponent(jobId)}&tab=publication`} onClick={() => onOpenChange(false)}>
                {pub.openGenerationJob}
              </Link>
            </Button>
          ) : null}
          {postUrl ? (
            <Button type="button" variant="outline" className="w-full" asChild>
              <a href={postUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                {pub.viewPost}
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="outline" className={cn("w-full")} onClick={() => onOpenChange(false)}>
            {pub.close}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
