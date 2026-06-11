"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";

import { api, formatContentApiError, type CampaignDetail } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { CampaignJobsTable, type CampaignJobRow } from "@/components/campaigns/CampaignJobsTable";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function statusVariant(status: string): "default" | "secondary" | "outline" {
  const s = status.toLowerCase();
  if (s === "active") return "default";
  if (s === "paused") return "secondary";
  return "outline";
}

function typeLabel(type: string, labels: Record<string, string>): string {
  const key = type.toLowerCase();
  if (key === "content") return labels.content;
  if (key === "growth") return labels.growth;
  if (key === "engagement") return labels.engagement;
  return type;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = String(params.id || "");
  const { text, t } = useLocale();
  const c = text.campaigns;

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [jobs, setJobs] = useState<CampaignJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchInFlightRef = useRef(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await api.distribution.getCampaign(campaignId);
      setCampaign(detail);

      const jobIds = detail.job_ids?.length
        ? detail.job_ids
        : Array.isArray(detail.settings?.generation_job_ids)
          ? detail.settings.generation_job_ids.filter((id): id is string => typeof id === "string")
          : [];

      const accountMap = new Map(
        (detail.accounts || []).map((a) => [a.id, `@${a.username}`]),
      );

      const rows: CampaignJobRow[] = [];
      await Promise.all(
        jobIds.map(async (jobId) => {
          try {
            const job = (await api.generationJobs.get(jobId)) as {
              status?: string;
              input_payload?: { target_accounts?: string[] };
            };
            const targetId = job.input_payload?.target_accounts?.[0];
            rows.push({
              id: jobId,
              status: String(job.status || "unknown"),
              accountLabel: targetId ? accountMap.get(targetId) : undefined,
            });
          } catch {
            rows.push({ id: jobId, status: "unknown" });
          }
        }),
      );
      setJobs(rows);
    } catch (e: unknown) {
      setError(formatContentApiError(e, c.detailLoadError));
    } finally {
      setLoading(false);
    }
  }, [campaignId, c.detailLoadError]);

  useEffect(() => {
    load();
  }, [load]);

  const isPaused = campaign?.status.toLowerCase() === "paused";
  const isCompleted = campaign?.status.toLowerCase() === "completed";
  const isAutomated = campaign?.type.toLowerCase() === "growth";

  const statusText = useMemo(() => {
    if (!campaign) return "";
    const s = campaign.status.toLowerCase();
    if (s === "active") return c.statusActive;
    if (s === "paused") return c.statusPaused;
    if (s === "completed") return c.statusCompleted;
    return campaign.status;
  }, [campaign, c.statusActive, c.statusPaused, c.statusCompleted]);

  const handleGenerate = async () => {
    if (!campaign || launchInFlightRef.current) return;
    launchInFlightRef.current = true;
    setLaunching(true);
    setError(null);

    const settings = campaign.settings || {};
    const accountIds: string[] =
      campaign.account_ids?.length
        ? campaign.account_ids
        : Array.isArray(settings.account_ids) && settings.account_ids.length > 0
          ? settings.account_ids
          : campaign.target_account_id
            ? [campaign.target_account_id]
            : [];
    const campaignTopic = String(settings.topic || campaign.target_niche || "");

    if (accountIds.length === 0) {
      const msg = c.noIgAccounts;
      setError(msg);
      toast.error(msg);
      launchInFlightRef.current = false;
      setLaunching(false);
      return;
    }

    const jobIds: string[] = [];
    try {
      for (const accountId of accountIds) {
        const { job_id } = await api.generationJobs.create({
          execution_mode: "multi_scene_single_video",
          content_type: "reel",
          mode: "faceless",
          niche: campaign.target_niche || "general",
          topic: campaignTopic,
          target_accounts: [accountId],
          campaign_id: campaign.id,
        });
        await api.generationJobs.launch(job_id);
        jobIds.push(job_id);
      }
      await api.distribution.patchCampaignSettings(campaign.id, {
        generation_job_ids: [...(settings.generation_job_ids || []), ...jobIds],
        last_launched_at: new Date().toISOString(),
      });
      toast.success(`${c.launchSuccess} (${jobIds.length} jobs)`);
      await load();
    } catch (e: unknown) {
      const msg = formatContentApiError(e, c.launchError);
      setError(msg);
      toast.error(msg);
    } finally {
      launchInFlightRef.current = false;
      setLaunching(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!campaign) return;
    const next = isPaused ? "active" : "paused";
    try {
      await api.distribution.updateCampaignStatus(campaign.id, next);
      toast.success(next === "paused" ? c.paused : c.resumed);
      await load();
    } catch (e: unknown) {
      toast.error(formatContentApiError(e, c.statusUpdateError));
    }
  };

  const handleMarkCompleted = async () => {
    if (!campaign) return;
    try {
      await api.distribution.updateCampaignStatus(campaign.id, "completed");
      toast.success(c.markCompletedSuccess);
      await load();
    } catch (e: unknown) {
      toast.error(formatContentApiError(e, c.statusUpdateError));
    }
  };

  const handleDelete = async () => {
    if (!campaign) return;
    setDeleteLoading(true);
    try {
      await api.distribution.deleteCampaign(campaign.id);
      toast.success(c.deleteSuccess);
      router.push("/campaigns");
    } catch (e: unknown) {
      toast.error(formatContentApiError(e, c.deleteError));
    } finally {
      setDeleteLoading(false);
      setDeleteOpen(false);
    }
  };

  if (loading && !campaign) {
    return (
      <div className="flex-1 space-y-6 p-8 pt-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !campaign) {
    return (
      <div className="flex-1 space-y-6 p-8 pt-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/campaigns">
            <ArrowLeft className="mr-1.5 size-4" />
            {c.backToList}
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{c.errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!campaign) return null;

  const topic = String(campaign.settings?.topic || "").trim();

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2" asChild>
            <Link href="/campaigns">
              <ArrowLeft className="mr-1.5 size-4" />
              {c.backToList}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{campaign.name}</h1>
            <Badge variant={statusVariant(campaign.status)}>{statusText}</Badge>
            <Badge variant="secondary">{typeLabel(campaign.type, c)}</Badge>
            <Badge variant={isAutomated ? "default" : "outline"}>
              {isAutomated ? c.automationAutomated : c.automationManual}
            </Badge>
          </div>
          {topic ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{topic}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">{c.noTopic}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={launching || isPaused || isCompleted}
          >
            {launching ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 size-4" />
            )}
            {c.generate}
          </Button>
          {!isCompleted ? (
            <Button variant="outline" size="sm" onClick={handleToggleStatus}>
              {isPaused ? (
                <>
                  <Play className="mr-1.5 size-4" />
                  {c.resume}
                </>
              ) : (
                <>
                  <Pause className="mr-1.5 size-4" />
                  {c.pause}
                </>
              )}
            </Button>
          ) : null}
          {!isCompleted ? (
            <Button variant="outline" size="sm" onClick={handleMarkCompleted}>
              <CheckCircle2 className="mr-1.5 size-4" />
              {c.markCompleted}
            </Button>
          ) : null}
          <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1.5 size-4" />
            {c.delete}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{c.errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{c.targetNiche}</CardDescription>
            <CardTitle className="text-lg">{campaign.target_niche || "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{c.detailAccounts}</CardDescription>
            <CardTitle className="text-lg">
              {(campaign.accounts || []).length || campaign.account_ids?.length || 0}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1 text-sm text-muted-foreground">
              {(campaign.accounts || []).map((acc) => (
                <li key={acc.id}>@{acc.username}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{c.detailJobs}</CardDescription>
            <CardTitle className="text-lg">{jobs.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{c.detailJobsTitle}</CardTitle>
          <CardDescription>{c.detailJobsDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <CampaignJobsTable
            jobs={jobs}
            labels={{
              jobId: c.detailJobId,
              status: c.statusLabel,
              account: c.targetAccount,
              studio: c.studio,
              empty: c.detailJobsEmpty,
            }}
          />
        </CardContent>
      </Card>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={c.deleteTitle}
        description={t("campaigns.deleteDescription", { name: campaign.name })}
        deleteLabel={c.delete}
        cancelLabel={c.cancel}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
