"use client";

import { AppStepper, ThreeColumnLayout, WorkspaceColumn } from "@/components/platform";
import { EngagementActionPanel } from "@/components/engagement/EngagementActionPanel";
import { EngagementCommentsPanel } from "@/components/engagement/EngagementCommentsPanel";
import type { EngagementComment } from "@/components/engagement/EngagementCommentsPanel";
import { EngagementPostPanel } from "@/components/engagement/EngagementPostPanel";
import type { EngagementPost } from "@/components/engagement/EngagementPostPanel";
import { stepsFromWorkflow } from "@/lib/platform/stepper";

type ActionType = "comment_like" | "comment_reply" | "dm_send";

type Labels = {
  workflowPost: string;
  workflowComments: string;
  workflowAction: string;
  stepPost: string;
  stepComments: string;
  stepAction: string;
  composerTitle: string;
  account: string;
  refreshPosts: string;
  loadingPosts: string;
  noPosts: string;
  commentsCountSuffix: string;
  publishedSuffix: string;
  viewOnInstagram: string;
  loadComments: string;
  filterComments: string;
  loadingComments: string;
  noComments: string;
  tokenScopeAlert: string;
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

export function EngagementCommentsView({
  labels,
  locale,
  posts,
  mediaId,
  loadingPosts,
  onSelectPost,
  onRefreshPosts,
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
  mediaIdForLoad,
  onLoadComments,
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
  likeAvailable,
  likeUnavailableMessage,
  postStepDone,
  commentsStepDone,
  actionStepActive,
  stepperAriaLabel,
}: {
  labels: Labels;
  locale: string;
  posts: EngagementPost[];
  mediaId: string;
  loadingPosts: boolean;
  onSelectPost: (id: string) => void;
  onRefreshPosts: () => void;
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
  mediaIdForLoad: string;
  onLoadComments: () => void;
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
  likeAvailable: boolean;
  likeUnavailableMessage?: string;
  postStepDone: boolean;
  commentsStepDone: boolean;
  actionStepActive: boolean;
  stepperAriaLabel: string;
}) {
  const stepperSteps = stepsFromWorkflow([
    { id: "post", label: labels.workflowPost, done: postStepDone, active: !postStepDone },
    {
      id: "comments",
      label: labels.workflowComments,
      done: commentsStepDone,
      active: postStepDone && !commentsStepDone,
    },
    {
      id: "action",
      label: labels.workflowAction,
      done: false,
      active: actionStepActive,
    },
  ]);

  return (
    <div className="space-y-4">
      <AppStepper steps={stepperSteps} aria-label={stepperAriaLabel} />

      <ThreeColumnLayout
        left={
          <WorkspaceColumn className="h-full min-h-[280px]">
            <EngagementPostPanel
              labels={{
                title: labels.stepPost,
                account: labels.account,
                refreshPosts: labels.refreshPosts,
                loadingPosts: labels.loadingPosts,
                noPosts: labels.noPosts,
                commentsCountSuffix: labels.commentsCountSuffix,
                publishedSuffix: labels.publishedSuffix,
                viewOnInstagram: labels.viewOnInstagram,
              }}
              locale={locale}
              posts={posts}
              mediaId={mediaId}
              loadingPosts={loadingPosts}
              onSelectPost={onSelectPost}
              onRefreshPosts={onRefreshPosts}
            />
          </WorkspaceColumn>
        }
        center={
          <WorkspaceColumn className="h-full min-h-[360px]">
            <EngagementCommentsPanel
              labels={{
                title: labels.stepComments,
                loadComments: labels.loadComments,
                filterComments: labels.filterComments,
                loadingComments: labels.loadingComments,
                noComments: labels.noComments,
                account: labels.account,
                tokenScopeAlert: labels.tokenScopeAlert,
              }}
              locale={locale}
              comments={comments}
              filteredComments={filteredComments}
              commentFilter={commentFilter}
              onCommentFilterChange={onCommentFilterChange}
              selectedCommentId={selectedCommentId}
              onSelectComment={onSelectComment}
              loadingComments={loadingComments}
              commentsLoaded={commentsLoaded}
              commentCount={commentCount}
              commentsHint={commentsHint}
              tokenScopeAlert={labels.tokenScopeAlert}
              mediaId={mediaIdForLoad}
              onLoadComments={onLoadComments}
            />
          </WorkspaceColumn>
        }
        right={
          <WorkspaceColumn className="h-full min-h-[320px]">
            <EngagementActionPanel
              labels={{
                title: labels.composerTitle,
                subtitle: labels.stepAction,
                actionType: labels.actionType,
                likeComment: labels.likeComment,
                replyAction: labels.replyAction,
                targetComment: labels.targetComment,
                noCommentSelected: labels.noCommentSelected,
                replyMessage: labels.replyMessage,
                replyPlaceholder: labels.replyPlaceholder,
                sendAction: labels.sendAction,
                generateReply: labels.generateReply,
                generateReplyLoading: labels.generateReplyLoading,
                likeDeviceNote: labels.likeDeviceNote,
                likeUnavailable: labels.likeUnavailable,
              }}
              actionType={actionType}
              onActionTypeChange={onActionTypeChange}
              selectedComment={selectedComment}
              messageText={messageText}
              onMessageTextChange={onMessageTextChange}
              submitting={submitting}
              generatingReply={generatingReply}
              onGenerateReply={onGenerateReply}
              onSubmit={onSubmit}
              canSubmit={canSubmit}
              likeAvailable={likeAvailable}
              likeUnavailableMessage={likeUnavailableMessage}
            />
          </WorkspaceColumn>
        }
      />
    </div>
  );
}
