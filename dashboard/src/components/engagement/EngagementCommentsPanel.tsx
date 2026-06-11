"use client";

import Link from "next/link";
import { Heart, Loader2, MessageCircle, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type EngagementComment = {
  id: string;
  text: string;
  username?: string | null;
  timestamp?: string | null;
  like_count?: number;
};

type Labels = {
  title: string;
  loadComments: string;
  filterComments: string;
  loadingComments: string;
  noComments: string;
  account: string;
  tokenScopeAlert: string;
};

function formatCommentDate(iso: string | null | undefined, locale: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function avatarInitial(username?: string | null) {
  const ch = (username || "?").trim().charAt(0).toUpperCase();
  return ch || "?";
}

export function EngagementCommentsPanel({
  labels,
  locale,
  comments,
  filteredComments,
  commentFilter,
  onCommentFilterChange,
  selectedCommentId,
  onSelectComment,
  loadingComments,
  commentsLoaded,
  commentCount,
  commentsHint,
  tokenScopeAlert,
  mediaId,
  onLoadComments,
}: {
  labels: Labels;
  locale: string;
  comments: EngagementComment[];
  filteredComments: EngagementComment[];
  commentFilter: string;
  onCommentFilterChange: (value: string) => void;
  selectedCommentId: string;
  onSelectComment: (id: string) => void;
  loadingComments: boolean;
  commentsLoaded: boolean;
  commentCount: number;
  commentsHint: string | null;
  tokenScopeAlert: string;
  mediaId: string;
  onLoadComments: () => void;
}) {
  const subtitle =
    comments.length > 0
      ? `${comments.length} / ${commentCount}`
      : commentsLoaded
        ? "0"
        : labels.loadingComments;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{labels.title}</h2>
          <p className="text-xs text-muted-foreground tabular-nums">{subtitle}</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {comments.length > 0 ? (
            <Input
              value={commentFilter}
              onChange={(e) => onCommentFilterChange(e.target.value)}
              placeholder={labels.filterComments}
              className="h-8 w-full sm:w-52"
            />
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0"
            onClick={onLoadComments}
            disabled={loadingComments || !mediaId}
          >
            {loadingComments ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {labels.loadComments}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {commentCount > 0 && comments.length === 0 && commentsLoaded ? (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription className="text-sm">
              {commentsHint || tokenScopeAlert}{" "}
              <Link href="/accounts" className="font-medium underline underline-offset-2">
                {labels.account}
              </Link>
            </AlertDescription>
          </Alert>
        ) : null}

        {loadingComments ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] w-full rounded-lg" />
            ))}
          </div>
        ) : filteredComments.length === 0 ? (
          <EmptyState
            icon={MessageCircle}
            title={commentsLoaded ? labels.noComments : labels.loadingComments}
            subtitle={commentsHint || undefined}
            className="py-12"
            cta={
              mediaId && commentsLoaded
                ? { label: labels.loadComments, onClick: onLoadComments }
                : undefined
            }
          />
        ) : (
          <div className="space-y-2">
            {filteredComments.map((comment) => {
              const selected = selectedCommentId === comment.id;
              const date = formatCommentDate(comment.timestamp, locale);
              return (
                <button
                  key={comment.id}
                  type="button"
                  onClick={() => onSelectComment(comment.id)}
                  className={cn(
                    "group w-full rounded-lg border p-3 text-left transition-all",
                    selected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                      : "border-border bg-background hover:border-primary/25 hover:bg-muted/20",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary",
                      )}
                    >
                      {avatarInitial(comment.username)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          @{comment.username || "?"}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                          <Heart className="h-3 w-3" />
                          {comment.like_count ?? 0}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-foreground/90">{comment.text}</p>
                      {date ? (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">{date}</p>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
