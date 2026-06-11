"use client";

import { Loader2, MessageCircle, Send, Sparkles, ThumbsUp } from "lucide-react";

import type { EngagementComment } from "@/components/engagement/EngagementCommentsPanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ActionType = "comment_like" | "comment_reply" | "dm_send";

type Labels = {
  title: string;
  subtitle: string;
  actionType: string;
  likeComment: string;
  replyAction: string;
  targetComment: string;
  noCommentSelected: string;
  replyMessage: string;
  replyPlaceholder: string;
  sendAction: string;
  generateReply: string;
  generateReplyLoading: string;
  likeDeviceNote: string;
  likeUnavailable: string;
};

export function EngagementActionPanel({
  labels,
  actionType,
  onActionTypeChange,
  selectedComment,
  messageText,
  onMessageTextChange,
  submitting,
  generatingReply,
  onGenerateReply,
  onSubmit,
  canSubmit,
  likeAvailable = true,
  likeUnavailableMessage,
}: {
  labels: Labels;
  actionType: ActionType;
  onActionTypeChange: (type: ActionType) => void;
  selectedComment?: EngagementComment;
  messageText: string;
  onMessageTextChange: (value: string) => void;
  submitting: boolean;
  generatingReply: boolean;
  onGenerateReply: () => void;
  onSubmit: () => void;
  canSubmit: boolean;
  likeAvailable?: boolean;
  likeUnavailableMessage?: string;
}) {
  const needsMsg = actionType === "comment_reply" || actionType === "dm_send";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{labels.title}</h2>
        <p className="text-xs text-muted-foreground">{labels.subtitle}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">{labels.actionType}</Label>
          <Tabs
            value={actionType}
            onValueChange={(v) => onActionTypeChange(v as ActionType)}
          >
            <TabsList className="grid h-9 w-full grid-cols-2">
              <TabsTrigger
                value="comment_like"
                className="gap-1.5 text-xs"
                disabled={!likeAvailable}
              >
                <ThumbsUp className="h-3.5 w-3.5" />
                {labels.likeComment}
              </TabsTrigger>
              <TabsTrigger value="comment_reply" className="gap-1.5 text-xs">
                <MessageCircle className="h-3.5 w-3.5" />
                {labels.replyAction}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {actionType === "comment_like" ? (
            <p className="rounded-md border border-amber-200/80 bg-amber-50/60 px-2.5 py-2 text-[11px] leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100/90">
              {likeUnavailableMessage || labels.likeDeviceNote}
            </p>
          ) : !likeAvailable ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {labels.likeUnavailable}
            </p>
          ) : null}
        </div>

        <Separator />

        {selectedComment ? (
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {labels.targetComment}
            </p>
            <p className="mt-1.5 text-sm font-medium">@{selectedComment.username || "?"}</p>
            <p className="mt-1 line-clamp-4 text-sm leading-relaxed text-foreground/90">
              {selectedComment.text}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed px-4 py-8 text-center">
            <p className="max-w-[220px] text-sm text-muted-foreground">{labels.noCommentSelected}</p>
          </div>
        )}

        {needsMsg ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="engagement-reply">{labels.replyMessage}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={onGenerateReply}
                disabled={generatingReply || !selectedComment}
              >
                {generatingReply ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {generatingReply ? labels.generateReplyLoading : labels.generateReply}
              </Button>
            </div>
            <textarea
              id="engagement-reply"
              value={messageText}
              onChange={(e) => onMessageTextChange(e.target.value)}
              placeholder={labels.replyPlaceholder}
              rows={5}
              className={cn(
                "min-h-[120px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
                "ring-offset-background placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
            />
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t p-4">
        <Button onClick={onSubmit} disabled={submitting || !canSubmit} className="w-full" size="lg">
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {labels.sendAction}
        </Button>
      </div>
    </div>
  );
}
