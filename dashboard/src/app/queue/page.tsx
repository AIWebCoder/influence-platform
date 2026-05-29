"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  ListOrdered,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";

import { api, formatContentApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PIPELINE_TARGET_ACCOUNT_STORAGE_KEY = "generation-studio-pipeline-target-account-id";
const QUEUE_PAGE_SIZE = 20;

type PipelineJob = {
  id: string;
  status: string;
  progress: number;
  caption?: string | null;
  topic?: string | null;
  content_type?: string | null;
  niche?: string | null;
  target_account_count: number;
  target_account_ids?: string[];
  target_account_usernames?: string[];
  output_url?: string | null;
  preview_url?: string | null;
  publish_intent_id?: string | null;
  publish_intent_status?: string | null;
  queue_display_title?: string | null;
  updated_at?: string | null;
};

type ReadyQueueAccountFilter = {
  id: string;
  username: string;
  count: number;
};

function isVideoUrl(url: string | null | undefined) {
  if (!url) return false;
  return /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes("video");
}

function formatWhen(iso: string | null | undefined, locale: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Short label for titles: @pclocal from email or username. */
function displayAccountLabel(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) return trimmed.split("@")[0].toLowerCase();
  return trimmed.replace(/^@/, "").toLowerCase();
}

function effectiveAccountId(job: PipelineJob, fallbackAccountId?: string): string | null {
  const fromJob = job.target_account_ids?.[0];
  if (fromJob) return fromJob;
  return fallbackAccountId || null;
}

function jobAccountLabel(job: PipelineJob, accountUsernameById: Map<string, string>): string | null {
  const id = effectiveAccountId(job);
  if (id) {
    const username = accountUsernameById.get(id);
    if (username) return displayAccountLabel(username);
  }
  for (const name of job.target_account_usernames ?? []) {
    const label = displayAccountLabel(name);
    if (label) return label;
  }
  return null;
}

export default function PipelineWaitingListPage() {
  const { locale, text, t } = useLocale();
  const q = text.readyQueue;
  const acc = text.generationStudio.accounts;
  const pub = text.generationStudio.publish;
  const [items, setItems] = useState<PipelineJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [accountFilters, setAccountFilters] = useState<ReadyQueueAccountFilter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [publishJob, setPublishJob] = useState<PipelineJob | null>(null);
  const [publishAccounts, setPublishAccounts] = useState<string[]>([]);
  const [publishCaption, setPublishCaption] = useState("");
  const [publishHashtags, setPublishHashtags] = useState("");
  const [captionGenLoading, setCaptionGenLoading] = useState(false);
  const [implicitAccountId, setImplicitAccountId] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const persistAccountsRef = useRef(false);

  const { data: accountChoices = [] } = useSWR<Array<{ id: string; username: string }>>(
    "distribution-accounts-queue-publish",
    async () => {
      const list = (await api.distribution.getAccounts()) as Array<{ id?: string; username?: string }>;
      return list
        .map((row) => ({
          id: typeof row?.id === "string" ? row.id.trim() : "",
          username: typeof row?.username === "string" ? row.username.trim() : "",
        }))
        .filter((row) => Boolean(row.id) && Boolean(row.username));
    }
  );

  const accountUsernameById = useMemo(
    () => new Map(accountChoices.map((a) => [a.id, a.username])),
    [accountChoices]
  );

  const totalPages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  const rangeFrom = total === 0 ? 0 : page * QUEUE_PAGE_SIZE + 1;
  const rangeTo = total === 0 ? 0 : Math.min(total, (page + 1) * QUEUE_PAGE_SIZE);

  const publishAccountSummary = useMemo(() => {
    if (publishAccounts.length === 0) return acc.selectTargets;
    const labels = publishAccounts
      .map((id) => accountChoices.find((a) => a.id === id)?.username || id)
      .filter(Boolean);
    if (labels.length <= 2) return labels.map((u) => `@${u}`).join(", ");
    return t("generationStudio.accounts.nSelected", { count: publishAccounts.length });
  }, [publishAccounts, accountChoices, acc.selectTargets, t]);

  const load = useCallback(
    async (opts?: { page?: number; accountId?: string }) => {
      const activePage = opts?.page ?? page;
      const activeAccountId =
        opts?.accountId !== undefined
          ? opts.accountId
          : accountFilter === "all"
            ? undefined
            : accountFilter;
      setError(null);
      try {
        const data = await api.generationJobs.listReadyQueue({
          limit: QUEUE_PAGE_SIZE,
          skip: activePage * QUEUE_PAGE_SIZE,
          accountId: activeAccountId,
        });
        setItems(data.items);
        setTotal(data.total);
        setAccountFilters(data.account_filters ?? []);
        setPage(activePage);
      } catch {
        setError(q.loadError);
      } finally {
        setLoading(false);
      }
    },
    [page, accountFilter, q.loadError]
  );

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(PIPELINE_TARGET_ACCOUNT_STORAGE_KEY);
      if (stored) setImplicitAccountId(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!implicitAccountId && accountChoices.length === 1) {
      setImplicitAccountId(accountChoices[0].id);
    }
  }, [accountChoices, implicitAccountId]);

  useEffect(() => {
    if (!implicitAccountId) return;
    try {
      localStorage.setItem(PIPELINE_TARGET_ACCOUNT_STORAGE_KEY, implicitAccountId);
    } catch {
      /* ignore */
    }
  }, [implicitAccountId]);

  useEffect(() => {
    if (!implicitAccountId || loading || items.length === 0 || persistAccountsRef.current) return;
    const pending = items.filter((j) => !(j.target_account_ids?.length));
    if (pending.length === 0) return;
    persistAccountsRef.current = true;
    void (async () => {
      try {
        await Promise.all(
          pending.map((job) => api.generationJobs.setTargetAccounts(job.id, [implicitAccountId]))
        );
        await load();
      } catch {
        toast.error(q.labelAccountSaveFailed);
      } finally {
        persistAccountsRef.current = false;
      }
    })();
  }, [implicitAccountId, items, loading, load, q.labelAccountSaveFailed]);

  const publishTargetsLocked = useMemo(() => {
    if (!publishJob) return { locked: false, label: "" };
    const fromJob = publishJob.target_account_ids ?? [];
    if (fromJob.length === 1) {
      const username =
        accountUsernameById.get(fromJob[0]) || publishJob.target_account_usernames?.[0] || "";
      return { locked: true, label: displayAccountLabel(username) || username };
    }
    if (fromJob.length > 1) return { locked: false, label: "" };
    if (implicitAccountId) {
      const username = accountUsernameById.get(implicitAccountId) || "";
      return { locked: true, label: displayAccountLabel(username) || username };
    }
    return { locked: false, label: "" };
  }, [publishJob, implicitAccountId, accountUsernameById]);

  const parseHashtags = (raw: string): string[] => {
    return raw
      .split(",")
      .map((t) => t.replace(/^#/, "").trim())
      .filter(Boolean);
  };

  const openPublishDialog = (job: PipelineJob) => {
    setPublishJob(job);
    const fromJob = job.target_account_ids ?? [];
    if (fromJob.length > 0) setPublishAccounts(fromJob);
    else if (implicitAccountId) setPublishAccounts([implicitAccountId]);
    else setPublishAccounts([]);
    setPublishCaption((job.caption || job.topic || "").trim());
    setPublishHashtags("");
    setCaptionGenLoading(false);
  };

  const handleGenerateCaption = async () => {
    if (!publishJob) return;
    const nicheKey = (publishJob.niche || "").trim() || "lifestyle";
    const topic = (publishJob.topic || publishCaption || "").trim() || undefined;
    let contentType = publishJob.content_type;
    if (contentType !== "reel" && contentType !== "post" && contentType !== "story") {
      contentType = "reel";
    }
    const reelEnabled =
      String(process.env.NEXT_PUBLIC_FEATURE_INSTAGRAM_REEL_PUBLISH_ENABLED ?? "true").toLowerCase() ===
      "true";
    if (!reelEnabled && contentType === "reel") {
      contentType = "post";
    }
    setCaptionGenLoading(true);
    try {
      const { caption, hashtags } = await api.content.generateCaption({
        niche: nicheKey,
        topic,
        content_type: contentType,
      });
      setPublishCaption(caption);
      setPublishHashtags(
        hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean).join(", ")
      );
      toast.success(pub.captionGenerated);
    } catch (e: unknown) {
      toast.error(formatContentApiError(e, pub.captionError));
    } finally {
      setCaptionGenLoading(false);
    }
  };

  const handlePublishConfirm = async () => {
    if (!publishJob) return;
    if (publishAccounts.length === 0) {
      toast.error(q.accountsRequired);
      return;
    }
    setBusyId(publishJob.id);
    try {
      const out = (await api.generationJobs.dispatchCompletedJob(publishJob.id, publishAccounts, {
        caption: publishCaption.trim(),
        hashtags: parseHashtags(publishHashtags),
      })) as { dispatched_targets?: number };
      toast.success(t("readyQueue.publishSuccess", { count: out?.dispatched_targets ?? 0 }));
      setPublishJob(null);
      await load();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : e instanceof Error
            ? e.message
            : q.publishFailed;
      toast.error(msg || q.publishFailed);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (job: PipelineJob) => {
    if (!confirm(q.deleteConfirm)) return;
    setBusyId(job.id);
    try {
      await api.generationJobs.delete(job.id);
      toast.success(q.deleted);
      const nextPage = items.length === 1 && page > 0 ? page - 1 : page;
      await load({ page: nextPage });
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String((e as { response?: { data?: { detail?: string } } }).response?.data?.detail || "")
          : e instanceof Error
            ? e.message
            : q.deleteFailed;
      toast.error(msg || q.deleteFailed);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex-1 w-full space-y-6 p-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ListOrdered className="size-6 text-primary" />
            {q.title}
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{q.subtitle}</p>
          {!loading && total > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("readyQueue.showingRange", { from: rangeFrom, to: rangeTo, total })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accountFilters.length > 1 ? (
            <div className="flex items-center gap-2">
              <Label className="sr-only">{q.filterByAccount}</Label>
              <Select
                value={accountFilter}
                onValueChange={(value) => {
                  setAccountFilter(value);
                  setLoading(true);
                  void load({
                    page: 0,
                    accountId: value === "all" ? undefined : value,
                  });
                }}
              >
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{q.filterAll}</SelectItem>
                  {accountFilters.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      @{displayAccountLabel(account.username)} ({account.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              setLoading(true);
              void load();
            }}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" asChild>
            <Link href="/generation-studio" target="_blank" rel="noopener noreferrer">
              <Rocket className="mr-1.5 size-4" />
              {q.openStudio}
            </Link>
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{q.empty}</p>
            <Button className="mt-4" asChild>
              <Link href="/generation-studio" target="_blank" rel="noopener noreferrer">
                {q.openStudio}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 && accountFilter !== "all" ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <p>{q.filterEmpty}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4">
          <TooltipProvider delayDuration={300}>
          {items.map((job) => {
            const busy = busyId === job.id;
            const preview = job.preview_url || job.output_url;
            const label =
              job.queue_display_title ||
              job.caption ||
              job.topic ||
              job.id.slice(0, 8);
            const accountLabel = jobAccountLabel(job, accountUsernameById);

            return (
              <Card key={job.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col sm:flex-row">
                    <div className="shrink-0 border-b bg-muted/20 sm:w-[180px] sm:border-b-0 sm:border-r">
                      {preview ? (
                        <div className="aspect-[9/16] max-h-[280px] w-full sm:max-h-none">
                          {isVideoUrl(preview) ? (
                            <video
                              src={preview}
                              className="h-full w-full object-cover"
                              controls
                              playsInline
                              preload="metadata"
                            />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={preview} alt={q.preview} className="h-full w-full object-cover" />
                          )}
                        </div>
                      ) : (
                        <div className="flex aspect-[9/16] items-center justify-center p-4 text-center text-xs text-muted-foreground">
                          {q.noPreview}
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-3">
                          <CardTitle className="text-lg font-semibold leading-snug">{label}</CardTitle>

                          <div className="flex flex-wrap items-center gap-2">
                            {accountLabel ? (
                              <Badge variant="outline" className="font-normal">
                                @{accountLabel}
                              </Badge>
                            ) : null}
                            {job.niche ? (
                              <Badge variant="outline" className="font-normal capitalize">
                                {job.niche}
                              </Badge>
                            ) : null}
                            {job.content_type ? (
                              <Badge variant="outline" className="font-normal uppercase">
                                {job.content_type}
                              </Badge>
                            ) : null}
                            <span className="text-xs text-muted-foreground">
                              {formatWhen(job.updated_at, locale)}
                            </span>
                          </div>

                          {(job.caption || job.topic) && label !== (job.caption || job.topic) ? (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
                              {job.caption || job.topic}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-2">
                          <div className="flex items-center gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="size-8"
                                  asChild
                                >
                                  <Link
                                    href={`/generation-studio?job=${encodeURIComponent(job.id)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={q.openStudio}
                                  >
                                    <ExternalLink className="size-4" />
                                  </Link>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{q.openStudio}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  className="size-8"
                                  disabled={busy}
                                  onClick={() => openPublishDialog(job)}
                                  aria-label={q.publish}
                                >
                                  {busy ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Send className="size-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{q.publish}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="destructive"
                                  size="icon"
                                  className="size-8"
                                  disabled={busy}
                                  onClick={() => void handleDelete(job)}
                                  aria-label={q.delete}
                                >
                                  {busy ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="size-4" />
                                  )}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{q.delete}</TooltipContent>
                            </Tooltip>
                          </div>
                          <Badge variant="secondary">{q.readyBadge}</Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </TooltipProvider>
          </div>

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                {t("readyQueue.pageOf", { page: page + 1, pages: totalPages })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 0 || loading}
                  aria-label={q.previousPage}
                  onClick={() => {
                    setLoading(true);
                    void load({ page: page - 1 });
                  }}
                >
                  <ChevronLeft className="size-4" />
                  {q.previousPage}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page + 1 >= totalPages || loading}
                  aria-label={q.nextPage}
                  onClick={() => {
                    setLoading(true);
                    void load({ page: page + 1 });
                  }}
                >
                  {q.nextPage}
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <Dialog
        open={publishJob !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPublishJob(null);
            setCaptionGenLoading(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{q.publishDialogTitle}</DialogTitle>
            <DialogDescription>
              {publishTargetsLocked.locked && publishTargetsLocked.label
                ? t("readyQueue.publishToAccount", { username: publishTargetsLocked.label })
                : q.publishDialogDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="mb-0">{pub.caption}</Label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="gap-1.5"
                disabled={captionGenLoading || busyId === publishJob?.id}
                onClick={() => void handleGenerateCaption()}
              >
                {captionGenLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {pub.generateCaption}
              </Button>
            </div>
            <textarea
              value={publishCaption}
              onChange={(e) => setPublishCaption(e.target.value)}
              placeholder={pub.captionPlaceholder}
              disabled={captionGenLoading}
              className={cn(
                "min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>{pub.hashtags}</Label>
            <Input
              value={publishHashtags}
              onChange={(e) => setPublishHashtags(e.target.value)}
              placeholder={pub.hashtagsPlaceholder}
              disabled={captionGenLoading}
            />
          </div>
          {publishTargetsLocked.locked ? (
            publishTargetsLocked.label ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="text-muted-foreground">{text.generationStudio.publish.targetAccounts}: </span>
                <span className="font-medium">@{publishTargetsLocked.label}</span>
              </div>
            ) : null
          ) : (
            <div className="space-y-2">
              <Label>{text.generationStudio.publish.targetAccounts}</Label>
              {accountChoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{q.noAccountOnJob}</p>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between font-normal">
                      <span className="truncate text-left">{publishAccountSummary}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                    <DropdownMenuLabel>{acc.selectOneOrMore}</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {accountChoices.map((account) => (
                      <DropdownMenuCheckboxItem
                        key={account.id}
                        checked={publishAccounts.includes(account.id)}
                        onCheckedChange={(checked) => {
                          setPublishAccounts((prev) =>
                            checked
                              ? Array.from(new Set([...prev, account.id]))
                              : prev.filter((id) => id !== account.id)
                          );
                        }}
                        onSelect={(event) => event.preventDefault()}
                      >
                        @{displayAccountLabel(account.username)}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPublishJob(null)}>
              {text.generationStudio.edit.cancel}
            </Button>
            <Button
              type="button"
              disabled={busyId === publishJob?.id || publishAccounts.length === 0}
              onClick={() => void handlePublishConfirm()}
            >
              {busyId === publishJob?.id ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <Send className="mr-1 size-3.5" />
              )}
              {q.publishConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
