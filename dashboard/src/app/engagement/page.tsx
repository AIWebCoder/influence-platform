"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, RefreshCw, Send } from "lucide-react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
  const { text, t } = useLocale();
  const eng = text.engagement;
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]);
  const [posts, setPosts] = useState<IgPost[]>([]);
  const [comments, setComments] = useState<IgComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [mediaId, setMediaId] = useState("");
  const [selectedCommentId, setSelectedCommentId] = useState("");
  const [actionType, setActionType] = useState<"comment_like" | "comment_reply" | "dm_send">(
    "comment_reply",
  );
  const [messageText, setMessageText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [postsGraphError, setPostsGraphError] = useState<string | null>(null);
  const [commentsHint, setCommentsHint] = useState<string | null>(null);
  const [commentsCountReported, setCommentsCountReported] = useState<number | null>(null);
  const [commentsLoaded, setCommentsLoaded] = useState(false);

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
        const withComments = nextPosts.find(
          (p) => (p.comments_count ?? 0) > 0,
        );
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
        ax.response?.data?.hint ||
        ax.response?.data?.error ||
        eng.loadCommentsError;
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
    if (accountId && mediaId && posts.length > 0) {
      loadComments();
    }
  }, [accountId, mediaId, posts.length, loadComments]);

  const submit = async () => {
    const targetId =
      actionType === "dm_send"
        ? comments.find((c) => c.id === selectedCommentId)?.username || selectedCommentId
        : selectedCommentId;
    if (!accountId || !targetId) {
      return toast.error(eng.selectComment);
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
        parent_target_id: mediaId,
        message_text: needsMsg ? messageText.trim() : undefined,
        idempotency_key: `eng-${actionType}-${targetId}-${Date.now()}`,
      });
      await api.content.dispatchEngagementIntent(c.intent_id);
      toast.success(eng.queued);
      setMessageText("");
      await loadIntents();
    } catch {
      toast.error(eng.failed);
    } finally {
      setSubmitting(false);
    }
  };

  const selectedPost = posts.find((p) => p.media_id === mediaId);
  const commentCount =
    commentsCountReported ?? selectedPost?.comments_count ?? 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{eng.title}</h1>
        <p className="text-sm text-muted-foreground">{eng.subtitle}</p>
      </div>

      <Alert>
        <AlertDescription>{eng.tokenAlert}</AlertDescription>
      </Alert>
      {postsGraphError ? (
        <Alert variant="destructive">
          <AlertDescription className="text-xs break-all">{postsGraphError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{eng.stepPost}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{eng.account}</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
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
          </div>
          <div className="space-y-2">
            <Label>{eng.post}</Label>
            <Select value={mediaId} onValueChange={setMediaId} disabled={!posts.length}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    loadingPosts ? eng.loadingPosts : eng.noPosts
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {posts.map((p) => (
                  <SelectItem key={p.media_id} value={p.media_id}>
                    {(p.caption || p.media_id).slice(0, 60)}
                    {p.comments_count != null ? ` · ${p.comments_count}${eng.commentsCountSuffix}` : ""}
                    {p.source.includes("database") ? eng.publishedSuffix : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedPost?.permalink && (
            <p className="sm:col-span-2 text-xs text-muted-foreground">
              <a href={selectedPost.permalink} target="_blank" rel="noreferrer" className="underline">
                {selectedPost.permalink}
              </a>
            </p>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="outline" size="sm" onClick={loadPosts} disabled={loadingPosts || !accountId}>
              {loadingPosts ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              {eng.refreshPosts}
            </Button>
            <Button size="sm" onClick={loadComments} disabled={loadingComments || !mediaId}>
              {loadingComments ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
              {eng.loadComments}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{eng.stepComments}</CardTitle>
        </CardHeader>
        <CardContent>
          {commentCount > 0 && comments.length === 0 && commentsLoaded ? (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription className="text-sm">
                {commentsHint ||
                  t("engagement.tokenScopeAlert", { count: commentCount })}
              </AlertDescription>
            </Alert>
          ) : null}
          {loadingComments ? (
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
          ) : comments.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {commentsLoaded
                ? commentsHint || eng.noComments
                : eng.loadingComments}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{eng.author}</TableHead>
                  <TableHead>{eng.comment}</TableHead>
                  <TableHead>{eng.likes}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {comments.map((c) => (
                  <TableRow
                    key={c.id}
                    className={selectedCommentId === c.id ? "bg-muted/50" : undefined}
                    onClick={() => setSelectedCommentId(c.id)}
                  >
                    <TableCell className="font-medium">@{c.username || "?"}</TableCell>
                    <TableCell className="max-w-md text-sm">{c.text}</TableCell>
                    <TableCell>{c.like_count ?? 0}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant={selectedCommentId === c.id ? "default" : "outline"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedCommentId(c.id);
                          setActionType("comment_reply");
                        }}
                      >
                        {eng.reply}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{eng.stepAction}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{eng.actionType}</Label>
            <Select value={actionType} onValueChange={(v) => setActionType(v as typeof actionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comment_like">{eng.likeComment}</SelectItem>
                <SelectItem value="comment_reply">{eng.replyAction}</SelectItem>
                <SelectItem value="dm_send" disabled>
                  DM ({eng.dmSoon})
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-muted-foreground">
              {eng.targetComment}:{" "}
              <span className="font-mono text-xs">{selectedCommentId || "—"}</span>
            </Label>
          </div>
          {needsMsg && (
            <div className="space-y-2 sm:col-span-2">
              <Label>{eng.replyMessage}</Label>
              <Input
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={eng.replyPlaceholder}
              />
            </div>
          )}
          <Button
            onClick={submit}
            disabled={submitting || !selectedCommentId}
            className="sm:col-span-2"
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {eng.sendAction}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{eng.history}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Loader2 className="mx-auto h-8 w-8 animate-spin" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{eng.historyType}</TableHead>
                  <TableHead>{eng.historyTarget}</TableHead>
                  <TableHead>{eng.historyStatus}</TableHead>
                  <TableHead>{eng.historyResult}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intents.map((r) => (
                  <TableRow key={r.intent_id}>
                    <TableCell>{r.action_type}</TableCell>
                    <TableCell className="max-w-[120px] truncate font-mono text-xs">{r.target_id}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.external_result_id || r.error_message || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
