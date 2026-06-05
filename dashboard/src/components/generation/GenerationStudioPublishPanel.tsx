"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Bookmark,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Circle,
  Loader2,
  Rocket,
  Sparkles,
  X,
} from "lucide-react";
import toast from "react-hot-toast";

import { useLocale } from "@/components/i18n/LocaleProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api, formatContentApiError } from "@/lib/api";
import { jobOutputMediaProxyUrl, KIE_IMAGE_PROPS } from "@/lib/media-url";
import { PublicationStatusCard } from "@/components/generation/PublicationStatusCard";
import type { StudioPublishActivity } from "@/lib/generation-studio-workflow";
import {
  isPublicationOutcomeTerminal,
  resolvePublicationOutcome,
  type PublicationOutcome,
  type PublishIntentResponse,
} from "@/lib/publication-outcome";
import { cn } from "@/lib/utils";

type ContentType = "post" | "reel" | "story";
type PublishMode = "publish_now" | "save_for_later" | "scheduled";

export type PublishPanelAsset = {
  id: string;
  asset_type: "image" | "video" | "thumbnail";
  public_url: string;
  mime_type: string;
};

function normalizeHashtagToken(raw: string): string | null {
  const t = raw.replace(/^#+/, "").trim();
  if (!t) return null;
  return t;
}

function parseHashtagList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map(normalizeHashtagToken)
    .filter((x): x is string => Boolean(x));
}

function formatHashtagsForApi(tags: string[]): string[] {
  return tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
}

function PublishSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ReadinessRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {ok ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
      )}
      <span className={cn(ok ? "text-foreground" : "text-muted-foreground")}>{label}</span>
    </li>
  );
}

function HashtagChipInput({
  tags,
  onChange,
  placeholder,
  hint,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  hint: string;
}) {
  const [draft, setDraft] = useState("");

  const addFromDraft = useCallback(() => {
    const parts = parseHashtagList(draft);
    if (parts.length === 0) return;
    const next = [...tags];
    for (const p of parts) {
      if (!next.includes(p)) next.push(p);
    }
    onChange(next);
    setDraft("");
  }, [draft, onChange, tags]);

  return (
    <div className="space-y-2">
      <div className="flex min-h-[42px] flex-wrap gap-2 rounded-lg border border-input bg-muted/20 p-2">
        {tags.length === 0 ? (
          <span className="px-1 text-xs text-muted-foreground">{hint}</span>
        ) : (
          tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1 font-normal">
              #{tag}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-muted"
                aria-label={`Remove ${tag}`}
                onClick={() => onChange(tags.filter((t) => t !== tag))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addFromDraft();
          }
        }}
        onBlur={() => {
          if (draft.trim()) addFromDraft();
        }}
      />
    </div>
  );
}

function ModeCard({
  active,
  onSelect,
  icon,
  title,
  description,
}: {
  active: boolean;
  onSelect: () => void;
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-1 min-w-[140px] flex-col items-start gap-2 rounded-lg border p-3 text-left transition",
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
      )}
    >
      <span className={cn("rounded-md p-1.5", active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
        {icon}
      </span>
      <span className="text-sm font-medium leading-tight">{title}</span>
      <span className="text-xs text-muted-foreground leading-snug">{description}</span>
    </button>
  );
}

export function GenerationStudioPublishPanel({
  jobId,
  assets,
  accounts,
  publishNiche,
  publishTopic,
  preferPhotoAsset = false,
  onPublishActivity,
}: {
  jobId: string;
  assets: PublishPanelAsset[];
  accounts: Array<{ id: string; username: string }>;
  publishNiche: string;
  publishTopic: string;
  preferPhotoAsset?: boolean;
  onPublishActivity?: (activity: StudioPublishActivity) => void;
}) {
  const { text, t } = useLocale();
  const gs = text.generationStudio;
  const p = gs.publish;
  const acc = gs.accounts;
  const reelEnabled =
    String(process.env.NEXT_PUBLIC_FEATURE_INSTAGRAM_REEL_PUBLISH_ENABLED ?? "true").toLowerCase() === "true";

  const defaultAssetId = useMemo(() => {
    if (assets.length === 0) return "";
    const firstImage = assets.find((a) => a.asset_type === "image");
    const firstVideo = assets.find((a) => a.asset_type === "video");
    if (preferPhotoAsset) {
      return firstImage?.id || firstVideo?.id || assets[0].id;
    }
    return firstVideo?.id || firstImage?.id || assets[0].id;
  }, [assets, preferPhotoAsset]);

  const [selectedAssetId, setSelectedAssetId] = useState(defaultAssetId);
  const [contentType, setContentType] = useState<ContentType>("post");
  const [caption, setCaption] = useState("");
  const [hashtagTags, setHashtagTags] = useState<string[]>([]);
  const [mode, setMode] = useState<PublishMode>("publish_now");
  const [scheduledFor, setScheduledFor] = useState<Date | undefined>(undefined);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [immediateLoading, setImmediateLoading] = useState(false);
  const [captionGenLoading, setCaptionGenLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicationOutcome, setPublicationOutcome] = useState<PublicationOutcome | null>(null);
  const postNowInFlightRef = useRef(false);

  const clearOutcome = () => {
    setPublicationOutcome(null);
    setError(null);
  };

  const publishIntentId = publicationOutcome?.intent?.intent_id;
  const publishOutcomeTerminal =
    publicationOutcome != null && isPublicationOutcomeTerminal(publicationOutcome);

  useEffect(() => {
    if (!publishIntentId || publishOutcomeTerminal) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const fresh = await api.generationJobs.getPublishIntent(publishIntentId);
        if (cancelled) return;
        setPublicationOutcome((prev) => {
          if (!prev || prev.intent.intent_id !== publishIntentId) return prev;
          return resolvePublicationOutcome({
            intent: fresh,
            action: prev.action,
            dispatched: prev.dispatched,
            dispatchCount: prev.dispatchCount,
            errorMessage: prev.errorMessage,
          });
        });
      } catch {
        /* polling is best-effort */
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [publishIntentId, publishOutcomeTerminal]);

  useEffect(() => {
    setSelectedAssetId(defaultAssetId);
  }, [defaultAssetId]);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId]
  );
  const selectedMediaPreviewUrl = useMemo(() => {
    if (!selectedAsset) return null;
    return jobOutputMediaProxyUrl(jobId);
  }, [selectedAsset, jobId]);

  const accountSummary = useMemo(() => {
    if (selectedAccounts.length === 0) return acc.selectTargets;
    const labels = selectedAccounts
      .map((id) => accounts.find((a) => a.id === id)?.username || id)
      .filter(Boolean);
    if (labels.length <= 2) return labels.map((u) => `@${u}`).join(", ");
    return t("generationStudio.publish.accountsCount", { count: selectedAccounts.length });
  }, [selectedAccounts, accounts, acc.selectTargets, t]);

  const selectedAssetExists = Boolean(selectedAssetId) && assets.some((a) => a.id === selectedAssetId);
  const selectedAccountsValid = selectedAccounts.every((id) => accounts.some((a) => a.id === id));
  const hasScheduleError = mode === "scheduled" && (!scheduledFor || scheduledFor.getTime() <= Date.now());
  const scheduleOk = mode !== "scheduled" || Boolean(scheduledFor && scheduledFor.getTime() > Date.now());
  const captionOk = caption.trim().length > 0;
  const accountsOk = selectedAccounts.length > 0 && selectedAccountsValid;
  const canSubmit =
    selectedAssetExists && accountsOk && scheduleOk && !loading && !immediateLoading;

  const readinessComplete = selectedAssetExists && accountsOk && scheduleOk && captionOk;

  const parseApiError = (e: unknown, fallback: string) => formatContentApiError(e, fallback);

  const effectiveContentTypeForCopy: ContentType = useMemo(
    () => (!reelEnabled && contentType === "reel" ? "post" : contentType),
    [reelEnabled, contentType]
  );

  const contentTypeLabel =
    contentType === "reel" ? p.reel : contentType === "story" ? p.story : p.post;

  const modeSummaryLabel =
    mode === "publish_now" ? p.modeNowTitle : mode === "scheduled" ? p.modeScheduleTitle : p.modeDraftTitle;

  const onGenerateCaption = async () => {
    const nicheKey = (publishNiche || "").trim() || "lifestyle";
    setCaptionGenLoading(true);
    setError(null);
    try {
      const { caption: generated, hashtags } = await api.content.generateCaption({
        niche: nicheKey,
        topic: (publishTopic || "").trim() || undefined,
        content_type: effectiveContentTypeForCopy,
      });
      setCaption(generated);
      setHashtagTags(
        hashtags.map((h) => normalizeHashtagToken(h)).filter((x): x is string => Boolean(x))
      );
      toast.success(p.captionGenerated);
    } catch (e: unknown) {
      const message = parseApiError(e, p.captionError);
      setError(message);
      toast.error(message);
    } finally {
      setCaptionGenLoading(false);
    }
  };

  const buildPublishIdempotencyKey = (payloadMode: PublishMode) => {
    const finalContentType: ContentType = !reelEnabled && contentType === "reel" ? "post" : contentType;
    const accountKey = [...selectedAccounts].sort().join(",");
    const captionKey = caption.trim();
    const hashtagsKey = formatHashtagsForApi(hashtagTags).join(",");
    const base = `studio-${jobId}-${selectedAssetId}-${finalContentType}-${accountKey}-${captionKey}-${hashtagsKey}`;
    if (payloadMode === "scheduled" && scheduledFor) {
      return `${base}-sched-${scheduledFor.getTime()}`;
    }
    if (payloadMode === "save_for_later") {
      return `${base}-draft`;
    }
    return `${base}-now`;
  };

  const buildIntentPayload = (payloadMode: PublishMode) => {
    const payloadModeResolved: PublishMode =
      payloadMode === "scheduled" && !scheduledFor ? "publish_now" : payloadMode;
    const finalContentType: ContentType = !reelEnabled && contentType === "reel" ? "post" : contentType;
    return {
      asset_id: selectedAssetId,
      content_type: finalContentType,
      caption: caption.trim(),
      hashtags: formatHashtagsForApi(hashtagTags),
      mode: payloadModeResolved,
      scheduled_for:
        payloadModeResolved === "scheduled" && scheduledFor ? scheduledFor.toISOString() : undefined,
      target_account_ids: selectedAccounts,
      idempotency_key: buildPublishIdempotencyKey(payloadModeResolved),
    };
  };

  const onCreateIntent = async (forcedMode?: PublishMode) => {
    if (!canSubmit) return;
    const payloadMode: PublishMode =
      forcedMode ?? (mode === "scheduled" && !scheduledFor ? "publish_now" : mode);
    if (payloadMode === "scheduled" && hasScheduleError) {
      setError(p.scheduleError);
      toast.error(p.scheduleError);
      return;
    }
    setLoading(true);
    setError(null);
    setPublicationOutcome(null);
    try {
      const response = await api.generationJobs.createPublishIntent(jobId, buildIntentPayload(payloadMode));
      const action =
        forcedMode === "save_for_later"
          ? "save_draft"
          : payloadMode === "scheduled"
            ? "schedule"
            : "create_intent";
      setPublicationOutcome(
        resolvePublicationOutcome({
          intent: response,
          action,
          dispatched: false,
        })
      );
      onPublishActivity?.("intent");
      toast.success(p.intentSuccess);
    } catch (e: unknown) {
      const message = parseApiError(e, p.intentError);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const onPostNow = async () => {
    if (!canSubmit || postNowInFlightRef.current) return;
    if (hasScheduleError) {
      setError(p.scheduleError);
      toast.error(p.scheduleError);
      return;
    }
    postNowInFlightRef.current = true;
    setImmediateLoading(true);
    setError(null);
    setPublicationOutcome(null);
    try {
      const intent = await api.generationJobs.createPublishIntent(jobId, buildIntentPayload("publish_now"));
      onPublishActivity?.("intent");
      let dispatchCount = 0;
      let dispatchStatus = intent.status;
      try {
        const dispatched = await api.generationJobs.dispatchPublishIntent(intent.intent_id);
        dispatchCount = dispatched.dispatched_targets;
        dispatchStatus = dispatched.status ?? intent.status;
        onPublishActivity?.("dispatched");
        toast.success(t("generationStudio.publish.postStarted", { count: dispatched.dispatched_targets }));
      } catch (dispatchErr: unknown) {
        const message = parseApiError(dispatchErr, p.postNowError);
        setPublicationOutcome(
          resolvePublicationOutcome({
            intent: { ...intent, status: dispatchStatus },
            action: "post_now",
            dispatched: false,
            errorMessage: message,
          })
        );
        toast.error(message);
        return;
      }
      setPublicationOutcome(
        resolvePublicationOutcome({
          intent: { ...intent, status: dispatchStatus },
          action: "post_now",
          dispatched: true,
          dispatchCount,
        })
      );
    } catch (e: unknown) {
      const message = parseApiError(e, p.postNowError);
      setError(message);
      setPublicationOutcome(
        resolvePublicationOutcome({
          intent: { intent_id: "", status: "failed", targets: [] },
          action: "post_now",
          dispatched: false,
          errorMessage: message,
        })
      );
      toast.error(message);
    } finally {
      setImmediateLoading(false);
      postNowInFlightRef.current = false;
    }
  };

  const handlePrimaryAction = () => {
    if (mode === "publish_now") void onPostNow();
    else void onCreateIntent();
  };

  const primaryLabel =
    mode === "publish_now" ? p.postInstagramNow : mode === "scheduled" ? p.primarySchedule : p.saveForLater;

  const primaryLoading = mode === "publish_now" ? immediateLoading : loading;

  return (
    <Card className="overflow-hidden border-border/80 shadow-sm">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <CardTitle className="text-lg">{p.title}</CardTitle>
        <CardDescription>{p.description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid gap-0 lg:grid-cols-12">
          {/* Left: form */}
          <div className="space-y-8 border-b p-6 lg:col-span-7 lg:border-b-0 lg:border-r">
            <PublishSection title={p.sectionPublication}>
              {assets.length > 1 ? (
                <div className="space-y-2">
                  <Label>{p.selectMedia}</Label>
                  <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {assets.map((asset) => (
                        <SelectItem key={asset.id} value={asset.id}>
                          {asset.asset_type} · {asset.id.slice(0, 8)}…
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{p.contentType}</Label>
                  <Select value={contentType} onValueChange={(v) => setContentType(v as ContentType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="post">{p.post}</SelectItem>
                      <SelectItem value="story">{p.story}</SelectItem>
                      <SelectItem value="reel" disabled={!reelEnabled}>
                        {p.reel} {!reelEnabled ? p.reelDisabled : ""}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{p.targetAccounts}</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="h-10 w-full justify-between font-normal">
                        <span className="truncate text-left">{accountSummary}</span>
                        <ChevronDown className="h-4 w-4 shrink-0 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuLabel>{acc.selectOneOrMore}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {accounts.length === 0 ? (
                        <div className="px-2 py-1.5 text-sm text-muted-foreground">{acc.none}</div>
                      ) : (
                        accounts.map((account) => (
                          <DropdownMenuCheckboxItem
                            key={account.id}
                            checked={selectedAccounts.includes(account.id)}
                            onCheckedChange={(checked) => {
                              setSelectedAccounts((prev) =>
                                checked
                                  ? Array.from(new Set([...prev, account.id]))
                                  : prev.filter((a) => a !== account.id)
                              );
                            }}
                            onSelect={(event) => event.preventDefault()}
                          >
                            @{account.username}
                          </DropdownMenuCheckboxItem>
                        ))
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </PublishSection>

            <Separator />

            <PublishSection title={p.sectionContent}>
              <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Label className="text-base font-semibold">{p.caption}</Label>
                    <p className="text-xs text-muted-foreground">{p.captionHint}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="gap-1.5 shrink-0"
                    disabled={captionGenLoading}
                    onClick={() => void onGenerateCaption()}
                  >
                    {captionGenLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {p.generateCaption}
                  </Button>
                </div>
                <textarea
                  className="min-h-[200px] w-full resize-y rounded-lg border border-input bg-background px-4 py-3 text-base leading-relaxed text-foreground shadow-inner focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder={p.captionPlaceholder}
                />
              </div>
              <div className="space-y-2">
                <Label>{p.hashtags}</Label>
                <HashtagChipInput
                  tags={hashtagTags}
                  onChange={setHashtagTags}
                  placeholder={p.hashtagAddPlaceholder}
                  hint={p.hashtagAddHint}
                />
              </div>
            </PublishSection>

            <Separator />

            <PublishSection title={p.sectionPublishing}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <ModeCard
                  active={mode === "publish_now"}
                  onSelect={() => setMode("publish_now")}
                  icon={<Rocket className="h-4 w-4" />}
                  title={p.modeNowTitle}
                  description={p.modeNowDesc}
                />
                <ModeCard
                  active={mode === "scheduled"}
                  onSelect={() => setMode("scheduled")}
                  icon={<Calendar className="h-4 w-4" />}
                  title={p.modeScheduleTitle}
                  description={p.modeScheduleDesc}
                />
                <ModeCard
                  active={mode === "save_for_later"}
                  onSelect={() => setMode("save_for_later")}
                  icon={<Bookmark className="h-4 w-4" />}
                  title={p.modeDraftTitle}
                  description={p.modeDraftDesc}
                />
              </div>
              {mode === "scheduled" ? (
                <div className="max-w-md pt-1">
                  <DateTimePicker value={scheduledFor} onChange={setScheduledFor} placeholder={p.pickDateTime} />
                  {hasScheduleError ? (
                    <p className="mt-1.5 text-xs text-destructive">{p.scheduleError}</p>
                  ) : null}
                </div>
              ) : null}
            </PublishSection>

            <Separator />

            <PublishSection title={p.sectionActions}>
              <div className="rounded-lg border bg-muted/15 p-4 space-y-4">
                <p className="text-sm font-medium">{p.readinessTitle}</p>
                <ul className="space-y-2">
                  <ReadinessRow ok={selectedAssetExists} label={p.checkMedia} />
                  <ReadinessRow ok={captionOk} label={p.checkCaption} />
                  <ReadinessRow ok={accountsOk} label={p.checkAccounts} />
                  <ReadinessRow ok={scheduleOk} label={mode === "scheduled" ? p.checkSchedule : p.checkMode} />
                </ul>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    readinessComplete && canSubmit ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"
                  )}
                >
                  {readinessComplete && canSubmit ? p.readyYes : p.readyNo}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  size="lg"
                  className="w-full sm:flex-1 sm:min-w-[200px]"
                  disabled={!canSubmit || primaryLoading}
                  onClick={handlePrimaryAction}
                >
                  {primaryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  {primaryLabel}
                </Button>
                {mode === "publish_now" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto"
                    disabled={!canSubmit || loading || immediateLoading}
                    onClick={() => void onCreateIntent()}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {p.createIntent}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="w-full sm:w-auto"
                  disabled={!canSubmit || loading || immediateLoading}
                  onClick={() => void onCreateIntent("save_for_later")}
                >
                  {p.modeDraftTitle}
                </Button>
              </div>

              {error && !publicationOutcome ? <p className="text-sm text-destructive">{error}</p> : null}
            </PublishSection>
          </div>

          {/* Right: preview & summary */}
          <div className="space-y-4 bg-muted/10 p-6 lg:col-span-5 lg:sticky lg:top-6 lg:self-start">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {p.sectionSummary}
            </h3>

            <div className="overflow-hidden rounded-xl border bg-black shadow-md">
              {selectedAsset ? (
                selectedAsset.asset_type === "video" || selectedAsset.mime_type.startsWith("video/") ? (
                  <video
                    key={selectedMediaPreviewUrl ?? selectedAsset.public_url}
                    src={selectedMediaPreviewUrl ?? selectedAsset.public_url}
                    className="aspect-[9/16] max-h-[min(70vh,520px)] w-full object-contain"
                    controls
                    playsInline
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={selectedMediaPreviewUrl ?? selectedAsset.public_url}
                    alt=""
                    className="aspect-video w-full object-contain"
                    {...KIE_IMAGE_PROPS}
                  />
                )
              ) : (
                <div className="flex aspect-video items-center justify-center text-sm text-muted-foreground">
                  {p.noAssets}
                </div>
              )}
            </div>

            {assets.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {assets.map((asset) => {
                  const selected = asset.id === selectedAssetId;
                  const isVideo = asset.asset_type === "video" || asset.mime_type.startsWith("video/");
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => setSelectedAssetId(asset.id)}
                      className={cn(
                        "h-14 w-20 shrink-0 overflow-hidden rounded-md border transition",
                        selected ? "border-primary ring-2 ring-primary/30" : "border-border opacity-80 hover:opacity-100"
                      )}
                    >
                      {isVideo ? (
                        <video
                          src={jobOutputMediaProxyUrl(jobId)}
                          className="h-full w-full object-cover"
                          muted
                          playsInline
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={jobOutputMediaProxyUrl(jobId)}
                          alt=""
                          className="h-full w-full object-cover"
                          {...KIE_IMAGE_PROPS}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}

            <Card className="border-border/70 shadow-none">
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{p.summaryContentType}</span>
                  <span className="font-medium">{contentTypeLabel}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{p.summaryAccounts}</span>
                  <span className="font-medium text-right">
                    {selectedAccounts.length === 0
                      ? "—"
                      : t("generationStudio.publish.accountsCount", { count: selectedAccounts.length })}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{p.summaryMode}</span>
                  <span className="font-medium">{modeSummaryLabel}</span>
                </div>
                <Separator />
                <ul className="space-y-2">
                  <ReadinessRow ok={selectedAssetExists} label={p.checkMedia} />
                  <ReadinessRow ok={accountsOk} label={p.checkAccounts} />
                  <ReadinessRow ok={readinessComplete && canSubmit} label={p.readyYes} />
                </ul>
                <Badge
                  variant={readinessComplete && canSubmit ? "default" : "secondary"}
                  className="w-full justify-center py-1"
                >
                  {readinessComplete && canSubmit ? p.statusReady : p.statusPending}
                </Badge>
              </CardContent>
            </Card>
          </div>
        </div>

        {publicationOutcome ? (
          <div className="border-t bg-muted/10 p-6">
            <PublicationStatusCard
              outcome={publicationOutcome}
              accounts={accounts}
              jobId={jobId}
              onRetry={clearOutcome}
              onDismiss={clearOutcome}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
