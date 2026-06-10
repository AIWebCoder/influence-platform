"use client";

import { ExternalLink, Loader2, MessageSquare, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type EngagementPost = {
  media_id: string;
  caption?: string | null;
  permalink?: string | null;
  published_at?: string | null;
  source: string;
  comments_count?: number | null;
};

type Labels = {
  title: string;
  account: string;
  refreshPosts: string;
  loadingPosts: string;
  noPosts: string;
  commentsCountSuffix: string;
  publishedSuffix: string;
  viewOnInstagram: string;
};

function formatPostDate(iso: string | null | undefined, locale: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function postPreview(post: EngagementPost) {
  const caption = (post.caption || "").trim();
  return caption ? caption : post.media_id;
}

export function EngagementPostPanel({
  labels,
  locale,
  posts,
  mediaId,
  loadingPosts,
  onSelectPost,
  onRefreshPosts,
}: {
  labels: Labels;
  locale: string;
  posts: EngagementPost[];
  mediaId: string;
  loadingPosts: boolean;
  onSelectPost: (id: string) => void;
  onRefreshPosts: () => void;
}) {
  const selectedPost = posts.find((p) => p.media_id === mediaId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{labels.title}</h2>
          <p className="text-xs text-muted-foreground">{posts.length} total</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onRefreshPosts}
          disabled={loadingPosts}
          title={labels.refreshPosts}
        >
          {loadingPosts ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loadingPosts && posts.length === 0 ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[72px] w-full rounded-lg" />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <EmptyState icon={MessageSquare} title={labels.noPosts} className="py-10" />
        ) : (
          <div className="space-y-2">
            {posts.map((post) => {
              const selected = post.media_id === mediaId;
              const date = formatPostDate(post.published_at, locale);
              return (
                <button
                  key={post.media_id}
                  type="button"
                  onClick={() => onSelectPost(post.media_id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-all",
                    selected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20"
                      : "border-border bg-background hover:border-primary/30 hover:bg-muted/30",
                  )}
                >
                  <p className="line-clamp-2 text-sm leading-snug">{postPreview(post)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {post.comments_count != null ? (
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-normal">
                        {post.comments_count}
                        {labels.commentsCountSuffix}
                      </Badge>
                    ) : null}
                    {post.source.includes("database") ? (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                        {labels.publishedSuffix.trim()}
                      </Badge>
                    ) : null}
                    {date ? (
                      <span className="text-[10px] text-muted-foreground">{date}</span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedPost?.permalink ? (
        <div className="shrink-0 border-t px-4 py-2.5">
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
            <a href={selectedPost.permalink} target="_blank" rel="noreferrer">
              {labels.viewOnInstagram}
              <ExternalLink className="ml-1 inline h-3 w-3" />
            </a>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
