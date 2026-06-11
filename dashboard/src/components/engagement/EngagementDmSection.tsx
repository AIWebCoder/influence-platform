"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Loader2, MessageCircle, RefreshCw, Send, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import { api } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type DmConversation = {
  id: string;
  participant_id?: string | null;
  participant_username?: string | null;
  preview?: string | null;
  updated_time?: string | null;
};

export type DmMessage = {
  id: string;
  text: string;
  from_id?: string | null;
  from_username?: string | null;
  is_from_account?: boolean;
  created_time?: string | null;
};

type Labels = {
  dmTitle: string;
  dmLoad: string;
  dmEmpty: string;
  dmSelect: string;
  dmThreadEmpty: string;
  dmMessage: string;
  dmPlaceholder: string;
  dmSend: string;
  dmTokenHint: string;
  generateReply: string;
  generateReplyLoading: string;
  generateReplyDone: string;
  generateReplyError: string;
  queued: string;
  failed: string;
  loading: string;
};

function formatWhen(iso: string | null | undefined, locale: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EngagementDmSection({
  accountId,
  locale,
  labels,
  onIntentCreated,
}: {
  accountId: string;
  locale: string;
  labels: Labels;
  onIntentCreated: () => void | Promise<void>;
}) {
  const [conversations, setConversations] = useState<DmConversation[]>([]);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [messageText, setMessageText] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingReply, setGeneratingReply] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [dmHint, setDmHint] = useState<string | null>(null);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);
  const lastIncoming = useMemo(
    () => [...messages].reverse().find((m) => !m.is_from_account && m.text?.trim()),
    [messages],
  );

  const loadConversations = useCallback(async () => {
    if (!accountId) return;
    setLoadingConversations(true);
    setGraphError(null);
    setDmHint(null);
    try {
      const data = await api.content.listEngagementConversations({ account_id: accountId, limit: 40 });
      setConversations(data.conversations || []);
      if (data.hint) setDmHint(data.hint);
      if (data.graph_error) setGraphError(data.graph_error);
      if ((data.conversations?.length ?? 0) > 0) {
        setSelectedConversationId((prev) => {
          if (prev && data.conversations?.some((c) => c.id === prev)) return prev;
          return data.conversations![0].id;
        });
      } else {
        setSelectedConversationId("");
        setMessages([]);
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string; hint?: string } } };
      setGraphError(ax.response?.data?.error || labels.failed);
      if (ax.response?.data?.hint) setDmHint(ax.response.data.hint);
      setConversations([]);
    } finally {
      setLoadingConversations(false);
    }
  }, [accountId, labels.failed]);

  const loadMessages = useCallback(async () => {
    if (!accountId || !selectedConversationId) return;
    setLoadingMessages(true);
    try {
      const data = await api.content.listEngagementDmMessages(selectedConversationId, {
        account_id: accountId,
        limit: 40,
      });
      setMessages(data.messages || []);
      if (data.hint) setDmHint(data.hint);
    } catch {
      toast.error(labels.failed);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [accountId, selectedConversationId, labels.failed]);

  useEffect(() => {
    if (accountId) void loadConversations();
  }, [accountId, loadConversations]);

  useEffect(() => {
    if (accountId && selectedConversationId) void loadMessages();
  }, [accountId, selectedConversationId, loadMessages]);

  const generateReply = async () => {
    if (!lastIncoming) return toast.error(labels.dmSelect);
    setGeneratingReply(true);
    try {
      const { reply } = await api.content.generateEngagementReply({
        comment_text: lastIncoming.text,
        comment_username: lastIncoming.from_username || selectedConversation?.participant_username || undefined,
        locale,
      });
      setMessageText(reply);
      toast.success(labels.generateReplyDone);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { detail?: string; error?: string } } };
      toast.error(ax.response?.data?.detail || ax.response?.data?.error || labels.generateReplyError);
    } finally {
      setGeneratingReply(false);
    }
  };

  const submit = async () => {
    const recipientId =
      (lastIncoming?.from_id && !lastIncoming.is_from_account
        ? lastIncoming.from_id
        : null) || selectedConversation?.participant_id;
    const recipientUsername =
      (lastIncoming?.from_username && !lastIncoming.is_from_account
        ? lastIncoming.from_username
        : null) || selectedConversation?.participant_username;
    if (!accountId || !recipientId || !selectedConversationId) {
      return toast.error(labels.dmSelect);
    }
    if (!messageText.trim()) {
      return toast.error(labels.dmMessage);
    }
    setSubmitting(true);
    try {
      const intent = await api.content.createEngagementIntent({
        account_id: accountId,
        action_type: "dm_send",
        target_id: recipientId,
        target_type: "user",
        target_username: recipientUsername || undefined,
        parent_target_id: selectedConversationId,
        message_text: messageText.trim(),
        idempotency_key: `dm-${recipientId}-${Date.now()}`,
      });
      await api.content.dispatchEngagementIntent(intent.intent_id);
      toast.success(labels.queued);
      setMessageText("");
      await loadMessages();
      await onIntentCreated();
    } catch {
      toast.error(labels.failed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-[min(72vh,780px)] w-full gap-4 xl:grid-cols-12">
      <Card className="flex min-h-[320px] flex-col overflow-hidden shadow-sm xl:col-span-3">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{labels.dmTitle}</h2>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => void loadConversations()} disabled={loadingConversations}>
            {loadingConversations ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loadingConversations ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <EmptyState icon={Inbox} title={labels.dmEmpty} />
          ) : (
            <ul className="space-y-1">
              {conversations.map((conv) => {
                const active = conv.id === selectedConversationId;
                return (
                  <li key={conv.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedConversationId(conv.id)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                        active ? "border-primary/40 bg-primary/5" : "border-transparent hover:bg-muted/50",
                      )}
                    >
                      <p className="text-sm font-medium">@{conv.participant_username || "?"}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {conv.preview || labels.dmSelect}
                      </p>
                      {conv.updated_time ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">{formatWhen(conv.updated_time, locale)}</p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>

      <Card className="flex min-h-[360px] flex-col overflow-hidden shadow-sm xl:col-span-6">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {selectedConversation
              ? `@${selectedConversation.participant_username || "?"}`
              : labels.dmThreadEmpty}
          </h2>
        </div>
        {graphError ? (
          <Alert variant="destructive" className="m-3">
            <AlertDescription className="text-xs break-all">{graphError}</AlertDescription>
          </Alert>
        ) : null}
        {dmHint ? (
          <Alert className="m-3 border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
            <AlertDescription className="text-xs">{dmHint}</AlertDescription>
          </Alert>
        ) : null}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {loadingMessages ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-3/4" />
              ))}
            </div>
          ) : !selectedConversationId ? (
            <EmptyState icon={MessageCircle} title={labels.dmSelect} />
          ) : messages.length === 0 ? (
            <EmptyState icon={MessageCircle} title={labels.dmThreadEmpty} />
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  msg.is_from_account
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "bg-muted/60 text-foreground",
                )}
              >
                {!msg.is_from_account && msg.from_username ? (
                  <p className="mb-1 text-[10px] font-medium opacity-80">@{msg.from_username}</p>
                ) : null}
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                {msg.created_time ? (
                  <p className="mt-1 text-[10px] opacity-70">{formatWhen(msg.created_time, locale)}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </Card>

      <Card className="flex min-h-[320px] flex-col overflow-hidden shadow-sm xl:col-span-3">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{labels.dmSend}</h2>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground">{labels.dmTokenHint}</p>
          {lastIncoming ? (
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {labels.dmSelect}
              </p>
              <p className="mt-1 line-clamp-3 text-sm">{lastIncoming.text}</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="dm-reply">{labels.dmMessage}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => void generateReply()}
                disabled={generatingReply || !lastIncoming}
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
              id="dm-reply"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={labels.dmPlaceholder}
              rows={6}
              className={cn(
                "min-h-[140px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
                "ring-offset-background placeholder:text-muted-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
            />
          </div>
        </div>
        <div className="shrink-0 border-t p-4">
          <Button
            onClick={() => void submit()}
            disabled={submitting || !selectedConversation?.participant_id || !messageText.trim()}
            className="w-full"
            size="lg"
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {labels.dmSend}
          </Button>
        </div>
      </Card>
    </div>
  );
}
