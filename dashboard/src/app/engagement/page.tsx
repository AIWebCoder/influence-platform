"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Info,
  Inbox,
  Loader2,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Send,
} from "lucide-react";
import toast from "react-hot-toast";

import { EngagementActionPanel } from "@/components/engagement/EngagementActionPanel";
import { EngagementCommentsPanel } from "@/components/engagement/EngagementCommentsPanel";
import { EngagementDmSection } from "@/components/engagement/EngagementDmSection";
import { EngagementKpiStrip } from "@/components/engagement/EngagementKpiStrip";
import { EngagementPostPanel } from "@/components/engagement/EngagementPostPanel";
import { EngagementWorkflowBar } from "@/components/engagement/EngagementWorkflowBar";
import { createEngagementHistoryColumns } from "@/components/engagement/engagement-history-columns";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DashboardPageHeader } from "@/components/dashboard/DashboardPageHeader";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { api } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IntentRow = {
  intent_id: string;
  status: string;
  action_type: string;
  target_id: string;
  error_message?: string | null;
  external_result_id?: string | null;
};

type IgPost = {
  media_id: string;
  caption?: string | null;
  permalink?: string | null;
  published_at?: string | null;
  source: string;
  comments_count?: number | null;
};

type IgComment = {
  id: string;
  text: string;
  username?: string | null;
  timestamp?: string | null;
  like_count?: number;
};

export default function EngagementPage() {
  const { locale, text, t } = useLocale();
  const eng = text.engagement;
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [comments, setComments] = useState<IgComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [selectedCommentId, setSelectedCommentId] = useState("");
  const [commentFilter, setCommentFilter] = useState("");
  const [actionType, setActionType] = useState<"comment_like" | "comment_reply" | "dm_send">(
    "comment_reply",
  );
  const [messageText, setMessageText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generatingReply, setGeneratingReply] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IntentRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [postsGraphError, setPostsGraphError] = useState<string | null>(null);
  const [commentsHint, setCommentsHint] = useState<string | null>(null);
  const [commentsCountReported, setCommentsCountReported] = useState<number | null>(null);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [likeAvailable, setLikeAvailable] = useState(false);
  const [likeUnavailableMessage, setLikeUnavailableMessage] = useState<string | null>(null);
  const [engagementView, setEngagementView] = useState<"comments" | "dms">("comments");

  const needsMsg = actionType === "comment_reply" || actionType === "dm_send";

  const loadIntents = useCallback(async () => {
    const list = await api.content.listEngagementIntents({ limit: 80 });
    setIntents(list);
  }, []);

  const loadAccounts = useCallback(async () => {
    const accs = await api.distribution.getAccounts();
    const opts = (accs || []).map((a: { id: string; username: string }) => ({
      id: a.id,
      username: a.username,
    }));
    setAccounts(opts);
    if (!accountId && opts[0]) setAccountId(opts[0].id);
  }, [accountId]);

  const loadPosts = useCallback(async () => {
    if (!accountId) return;
    setLoadingPosts(true);
    setComments([]);
    setSelectedCommentId("");
    setCommentsHint(null);
    setCommentsCountReported(null);
    setCommentsLoaded(false);
    try {
      const data = await api.content.listEngagementPosts({
        account_id: accountId,
        limit: 30,
        include_graph: true,
      });
      setPostsGraphError(data.graph_error || null);
      const nextPosts = data.posts || [];
      setPosts(nextPosts);
      if (nextPosts.length) {
        const withComments = nextPosts.find((p) => (p.comments_count ?? 0) > 0);
        setMediaId((withComments || nextPosts[0]).media_id);
      } else {
        setMediaId("");
      }
    } catch {
      toast.error(eng.loadPostsError);
      setPosts([]);
    } finally {
      setLoadingPosts(false);
    }
  }, [accountId, eng.loadPostsError]);

  const loadCapabilities = useCallback(async () => {
    if (!accountId) return;
    try {
      const caps = await api.content.getEngagementCapabilities(accountId);
      setLikeAvailable(Boolean(caps.comment_like?.available));
      setLikeUnavailableMessage(caps.comment_like?.message || null);
      if (!caps.comment_like?.available) {
        setActionType((current) => (current === "comment_like" ? "comment_reply" : current));
      }
    } catch {
      setLikeAvailable(false);
      setLikeUnavailableMessage(eng.likeDeviceNote);
    }
  }, [accountId, eng.likeDeviceNote]);

  const loadComments = useCallback(async () => {
    if (!accountId || !mediaId) return;
    setLoadingComments(true);
    setSelectedCommentId("");
    setCommentsHint(null);
    setCommentsCountReported(null);
    const rawCaption = posts.find((p) => p.media_id === mediaId)?.caption || "";
    const captionHint =
      rawCaption.length > 120 ? `${rawCaption.slice(0, 120)}…` : rawCaption || undefined;
    try {
      const data = await api.content.listPostComments(mediaId, {
        account_id: accountId,
        limit: 80,
        caption_hint: captionHint,
      });
      if (data.original_media_id && data.original_media_id !== data.media_id) {
        setMediaId(data.media_id);
      }
      setComments(data.comments || []);
      setCommentsLoaded(true);
      setCommentsCountReported(data.comments_count_reported ?? null);
      if (data.hint) setCommentsHint(data.hint);
      if (data.dry_run) {
        toast(eng.dryRunComments, { icon: "ℹ️" });
      } else if ((data.comments?.length ?? 0) === 0 && data.hint) {
        toast(data.hint, { icon: "ℹ️", duration: 8000 });
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string; hint?: string } } };
      const msg =
        ax.response?.data?.hint || ax.response?.data?.error || eng.loadCommentsError;
      toast.error(msg);
      setComments([]);
      setCommentsLoaded(true);
      if (ax.response?.data?.hint) setCommentsHint(ax.response.data.hint);
    } finally {
      setLoadingComments(false);
    }
  }, [accountId, mediaId, eng.dryRunComments, eng.loadCommentsError, posts]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadIntents(), loadAccounts()]);
      } catch {
        toast.error(eng.loadFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadIntents, loadAccounts, eng.loadFailed]);

  useEffect(() => {
    if (accountId) loadPosts();
  }, [accountId, loadPosts]);

  useEffect(() => {
    if (accountId) void loadCapabilities();
  }, [accountId, loadCapabilities]);

  useEffect(() => {
    if (accountId && mediaId && posts.length > 0) {
      loadComments();
    }
  }, [accountId, mediaId, posts.length, loadComments]);

  useEffect(() => {
    const inFlight = intents.some((i) => ["queued", "processing"].includes(i.status));
    if (!inFlight) return;
    const timer = window.setInterval(() => {
      void loadIntents();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [intents, loadIntents]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadIntents(),
        accountId ? loadPosts() : Promise.resolve(),
        accountId && mediaId ? loadComments() : Promise.resolve(),
      ]);
    } catch {
      toast.error(eng.loadFailed);
    } finally {
      setRefreshing(false);
    }
  };

  const submit = async () => {
    const selected = comments.find((c) => c.id === selectedCommentId);
    const targetId =
      actionType === "dm_send"
        ? selected?.username || selectedCommentId
        : selectedCommentId;
    if (!accountId || !targetId) {
      return toast.error(eng.selectComment);
    }
    if (actionType === "comment_like" && !likeAvailable) {
      return toast.error(likeUnavailableMessage || eng.likeDeviceNote);
    }
    if (needsMsg && !messageText.trim()) {
      return toast.error(eng.messageRequired);
    }
    setSubmitting(true);
    try {
      const c = await api.content.createEngagementIntent({
        account_id: accountId,
        action_type: actionType,
        target_id: targetId,
        target_type: actionType === "dm_send" ? "user" : "comment",
        target_username: selected?.username || undefined,
        parent_target_id: mediaId,
        message_text: needsMsg
          ? messageText.trim()
          : actionType === "comment_like" && selected
            ? selected.text.slice(0, 200)
            : undefined,
        idempotency_key: `eng-${actionType}-${targetId}-${Date.now()}`,
      });
      await api.content.dispatchEngagementIntent(c.intent_id);
      toast.success(eng.queued);
      setMessageText("");
      await loadIntents();
      void (async () => {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
          const list = await api.content.listEngagementIntents({ limit: 80 });
          setIntents(list);
          const row = list.find((item) => item.intent_id === c.intent_id);
          if (row && (row.status === "completed" || row.status === "failed")) {
            if (row.status === "completed") {
              toast.success(eng.statusCompleted);
            } else if (row.error_message) {
              toast.error(row.error_message.slice(0, 160));
            }
            break;
          }
        }
      })();
    } catch {
      toast.error(eng.failed);
    } finally {
      setSubmitting(false);
    }
  };

  const generateReply = async () => {
    const selected = comments.find((c) => c.id === selectedCommentId);
    if (!selected) {
      return toast.error(eng.selectComment);
    }
    const post = posts.find((p) => p.media_id === mediaId);
    setGeneratingReply(true);
    try {
      const { reply } = await api.content.generateEngagementReply({
        comment_text: selected.text,
        comment_username: selected.username || undefined,
        post_caption: post?.caption || undefined,
        locale,
      });
      setMessageText(reply);
      toast.success(eng.generateReplyDone);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string; error?: string } } };
      const msg =
        ax.response?.data?.detail ||
        ax.response?.data?.error ||
        eng.generateReplyError;
      toast.error(msg);
    } finally {
      setGeneratingReply(false);
    }
  };

  const confirmDeleteIntent = async () => {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.intent_id);
    try {
      await api.content.deleteEngagementIntent(deleteTarget.intent_id);
      toast.success(eng.historyDeleteDone);
      setDeleteTarget(null);
      await loadIntents();
    } catch (err: unknown) {
      const ax = err as { response?: { status?: number } };
      if (ax.response?.status === 409) {
        toast.error(eng.historyDeleteBusy);
      } else {
        toast.error(eng.historyDeleteError);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const selectedPost = posts.find((p) => p.media_id === mediaId);
  const selectedComment = comments.find((c) => c.id === selectedCommentId);
  const selectedAccount = accounts.find((a) => a.id === accountId);
  const commentCount = commentsCountReported ?? selectedPost?.comments_count ?? 0;

  const intentStats = useMemo(() => {
    const pending = intents.filter((i) =>
      ["ready", "queued", "processing"].includes(i.status),
    ).length;
    const completed = intents.filter((i) => i.status === "completed").length;
    return { pending, completed };
  }, [intents]);

  const filteredComments = useMemo(() => {
    const q = commentFilter.trim().toLowerCase();
    if (!q) return comments;
    return comments.filter(
      (c) =>
        c.text.toLowerCase().includes(q) ||
        (c.username || "").toLowerCase().includes(q),
    );
  }, [comments, commentFilter]);

  const historyColumns = useMemo(
    () =>
      createEngagementHistoryColumns(
        {
          historyType: eng.historyType,
          historyTarget: eng.historyTarget,
          historyStatus: eng.historyStatus,
          historyResult: eng.historyResult,
          historyDelete: eng.historyDelete,
          likeComment: eng.likeComment,
          replyAction: eng.replyAction,
          dmAction: eng.dmAction,
          statusReady: eng.statusReady,
          statusQueued: eng.statusQueued,
          statusProcessing: eng.statusProcessing,
          statusCompleted: eng.statusCompleted,
          statusFailed: eng.statusFailed,
          dash: "—",
        },
        {
          onDelete: (row) => setDeleteTarget(row),
          deletingId,
        },
      ),
    [eng, deletingId],
  );

  const postStepDone = Boolean(accountId && mediaId);
  const commentsStepDone = commentsLoaded && comments.length > 0;
  const actionStepActive = Boolean(selectedCommentId);

  const workflowSteps = [
    { id: "post", label: eng.workflowPost, done: postStepDone, active: !postStepDone },
    {
      id: "comments",
      label: eng.workflowComments,
      done: commentsStepDone,
      active: postStepDone && !commentsStepDone,
    },
    {
      id: "action",
      label: eng.workflowAction,
      done: false,
      active: actionStepActive,
    },
  ];

  const kpiItems = [
    { title: eng.kpiPosts, value: posts.length, icon: MessageSquare, accent: "blue" as const },
    { title: eng.kpiComments, value: commentCount, icon: MessageCircle, accent: "violet" as const },
    { title: eng.kpiPending, value: intentStats.pending, icon: Send, accent: "amber" as const },
    { title: eng.kpiCompleted, value: intentStats.completed, icon: CheckCircle2, accent: "emerald" as const },
  ];

  return (
    <div className="ops-page-shell flex w-full min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <DashboardPageHeader title={eng.title} subtitle={eng.subtitle} />
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger className="h-9 w-full sm:w-[220px]">
              <SelectValue placeholder={eng.select} />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  @{a.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => void refreshAll()}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {eng.refresh}
          </Button>
        </div>
      </div>

      <EngagementKpiStrip items={kpiItems} />

      <Alert className="border-sky-200/80 bg-sky-50/50 dark:border-sky-900/50 dark:bg-sky-950/20">
        <Info className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <AlertTitle className="text-sky-900 dark:text-sky-100">{eng.tokenAlertTitle}</AlertTitle>
        <AlertDescription className="text-sm text-sky-800/90 dark:text-sky-200/80">
          {eng.tokenAlert}
          {selectedAccount ? (
            <span className="mt-1 block text-xs opacity-80">@{selectedAccount.username}</span>
          ) : null}
        </AlertDescription>
      </Alert>

      {postsGraphError ? (
        <Alert variant="destructive">
          <AlertDescription className="break-all text-xs">{postsGraphError}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={engagementView} onValueChange={(v) => setEngagementView(v as "comments" | "dms")}>
        <TabsList className="h-9 w-fit">
          <TabsTrigger value="comments" className="gap-1.5 px-3 text-xs">
            <MessageCircle className="h-3.5 w-3.5" />
            {eng.tabComments}
          </TabsTrigger>
          <TabsTrigger value="dms" className="gap-1.5 px-3 text-xs">
            <Inbox className="h-3.5 w-3.5" />
            {eng.tabDms}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {engagementView === "comments" ? (
        <>
      <EngagementWorkflowBar steps={workflowSteps} />

      <div className="grid min-h-[min(72vh,780px)] w-full gap-4 xl:grid-cols-12">
        <Card className="flex min-h-[280px] flex-col overflow-hidden shadow-sm xl:col-span-3">
          <EngagementPostPanel
            labels={{
              title: eng.stepPost,
              account: eng.account,
              refreshPosts: eng.refreshPosts,
              loadingPosts: eng.loadingPosts,
              noPosts: eng.noPosts,
              commentsCountSuffix: eng.commentsCountSuffix,
              publishedSuffix: eng.publishedSuffix,
              viewOnInstagram: eng.viewOnInstagram,
            }}
            locale={locale}
            posts={posts}
            mediaId={mediaId}
            loadingPosts={loadingPosts}
            onSelectPost={setMediaId}
            onRefreshPosts={() => void loadPosts()}
          />
        </Card>

        <Card className="flex min-h-[360px] flex-col overflow-hidden shadow-sm xl:col-span-6">
          <EngagementCommentsPanel
            labels={{
              title: eng.stepComments,
              loadComments: eng.loadComments,
              filterComments: eng.filterComments,
              loadingComments: eng.loadingComments,
              noComments: eng.noComments,
              account: eng.account,
              tokenScopeAlert: t("engagement.tokenScopeAlert", { count: commentCount }),
            }}
            locale={locale}
            comments={comments}
            filteredComments={filteredComments}
            commentFilter={commentFilter}
            onCommentFilterChange={setCommentFilter}
            selectedCommentId={selectedCommentId}
            onSelectComment={setSelectedCommentId}
            loadingComments={loadingComments}
            commentsLoaded={commentsLoaded}
            commentCount={commentCount}
            commentsHint={commentsHint}
            tokenScopeAlert={t("engagement.tokenScopeAlert", { count: commentCount })}
            mediaId={mediaId}
            onLoadComments={() => void loadComments()}
          />
        </Card>

        <Card className="flex min-h-[320px] flex-col overflow-hidden shadow-sm xl:col-span-3">
          <EngagementActionPanel
            labels={{
              title: eng.composerTitle,
              subtitle: eng.stepAction,
              actionType: eng.actionType,
              likeComment: eng.likeComment,
              replyAction: eng.replyAction,
              targetComment: eng.targetComment,
              noCommentSelected: eng.noCommentSelected,
              replyMessage: eng.replyMessage,
              replyPlaceholder: eng.replyPlaceholder,
              sendAction: eng.sendAction,
              generateReply: eng.generateReply,
              generateReplyLoading: eng.generateReplyLoading,
              likeDeviceNote: eng.likeDeviceNote,
              likeUnavailable: eng.likeUnavailable,
            }}
            actionType={actionType}
            onActionTypeChange={setActionType}
            selectedComment={selectedComment}
            messageText={messageText}
            onMessageTextChange={setMessageText}
            submitting={submitting}
            generatingReply={generatingReply}
            onGenerateReply={() => void generateReply()}
            onSubmit={() => void submit()}
            canSubmit={Boolean(selectedCommentId) && (actionType !== "comment_like" || likeAvailable)}
            likeAvailable={likeAvailable}
            likeUnavailableMessage={likeUnavailableMessage || undefined}
          />
        </Card>
      </div>
        </>
      ) : (
        <EngagementDmSection
          accountId={accountId}
          locale={locale}
          labels={{
            dmTitle: eng.dmTitle,
            dmLoad: eng.dmLoad,
            dmEmpty: eng.dmEmpty,
            dmSelect: eng.dmSelect,
            dmThreadEmpty: eng.dmThreadEmpty,
            dmMessage: eng.dmMessage,
            dmPlaceholder: eng.dmPlaceholder,
            dmSend: eng.dmSend,
            dmTokenHint: eng.dmTokenHint,
            generateReply: eng.generateReply,
            generateReplyLoading: eng.generateReplyLoading,
            generateReplyDone: eng.generateReplyDone,
            generateReplyError: eng.generateReplyError,
            queued: eng.queued,
            failed: eng.failed,
            loading: eng.loadingComments,
          }}
          onIntentCreated={() => void loadIntents()}
        />
      )}

      <Card className="w-full shadow-sm">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">{eng.history}</CardTitle>
            {!loading && intents.length > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {intents.length} total
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : intents.length === 0 ? (
            <EmptyState icon={Send} title={eng.historyEmpty} />
          ) : (
            <DataTable
              columns={historyColumns}
              data={intents}
              filterColumnId="action_type"
              filterPlaceholder={eng.historyType}
              emptyMessage={eng.historyEmpty}
              enablePagination
            />
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deletingId !== deleteTarget?.intent_id) setDeleteTarget(null);
        }}
        title={eng.historyDeleteTitle}
        description={eng.historyDeleteConfirm}
        deleteLabel={eng.historyDelete}
        cancelLabel={locale === "fr" ? "Annuler" : "Cancel"}
        onConfirm={() => void confirmDeleteIntent()}
        loading={deletingId !== null && deletingId === deleteTarget?.intent_id}
      />
    </div>
  );
}
