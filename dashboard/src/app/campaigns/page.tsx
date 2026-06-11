"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Megaphone,
  PauseCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import toast from "react-hot-toast";

import { api, formatContentApiError, type CampaignRecord } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import {
  createCampaignsColumns,
  type CampaignRow,
} from "@/components/campaigns/campaigns-columns";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type IgAccount = { id: string; username: string; platform?: string | null };

function StatCard({
  title,
  value,
  icon: Icon,
  sub,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
          </div>
          <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

function jobCount(campaign: CampaignRecord): number {
  const ids = campaign.settings?.generation_job_ids;
  return Array.isArray(ids) ? ids.length : 0;
}

export default function CampaignsPage() {
  const { text, t } = useLocale();
  const c = text.campaigns;

  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);
  const launchInFlightRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<CampaignRow | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [name, setName] = useState("");
  const [strategyType, setStrategyType] = useState<"content" | "growth" | "engagement">("content");
  const [niche, setNiche] = useState("fitness");
  const [topic, setTopic] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const igAccounts = useMemo(
    () => accounts.filter((a) => (a.platform || "instagram").toLowerCase() === "instagram"),
    [accounts],
  );

  const stats = useMemo(() => {
    const active = campaigns.filter((x) => x.status.toLowerCase() === "active").length;
    const paused = campaigns.filter((x) => x.status.toLowerCase() === "paused").length;
    const withJobs = campaigns.filter((x) => jobCount(x) > 0).length;
    return { total: campaigns.length, active, paused, withJobs };
  }, [campaigns]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [camps, accs] = await Promise.all([
        api.distribution.getCampaigns(),
        api.distribution.getAccounts(),
      ]);
      setCampaigns(camps);
      setAccounts(accs);
    } catch {
      setError(c.loadError);
    } finally {
      setLoading(false);
    }
  }, [c.loadError]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAccount = (id: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const resetForm = () => {
    setName("");
    setTopic("");
    setStrategyType("content");
    setNiche("fitness");
    setSelectedAccounts([]);
  };

  const handleCreate = async () => {
    if (!name.trim() || selectedAccounts.length === 0 || !topic.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.distribution.createCampaign({
        name: name.trim(),
        type: strategyType,
        target_niche: niche.trim(),
        target_account_id: selectedAccounts.length === 1 ? selectedAccounts[0] : null,
        settings: {
          topic: topic.trim(),
          account_ids: selectedAccounts,
          generation_job_ids: [],
        },
      });
      toast.success(c.createSuccess);
      setDialogOpen(false);
      resetForm();
      await load();
    } catch (e: unknown) {
      const msg = formatContentApiError(e, c.createError);
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLaunchJobs = useCallback(async (campaign: CampaignRecord) => {
    if (launchInFlightRef.current) return;
    launchInFlightRef.current = true;
    const settings = campaign.settings || {};
    const accountIds: string[] =
      Array.isArray(settings.account_ids) && settings.account_ids.length > 0
        ? settings.account_ids
        : campaign.target_account_id
          ? [campaign.target_account_id]
          : [];
    const campaignTopic = String(settings.topic || campaign.target_niche || niche);
    if (accountIds.length === 0) {
      const msg = c.noIgAccounts;
      setError(msg);
      toast.error(msg);
      launchInFlightRef.current = false;
      return;
    }

    setLaunchingId(campaign.id);
    setError(null);
    const jobIds: string[] = [];
    try {
      for (const accountId of accountIds) {
        const { job_id } = await api.generationJobs.create({
          execution_mode: "multi_scene_single_video",
          content_type: "reel",
          mode: "faceless",
          niche: campaign.target_niche || niche,
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
      setLaunchingId(null);
    }
  }, [c.launchSuccess, c.launchError, c.noIgAccounts, niche, load]);

  const handleToggleStatus = useCallback(async (campaign: CampaignRecord) => {
    const next = campaign.status.toLowerCase() === "active" ? "paused" : "active";
    try {
      await api.distribution.updateCampaignStatus(campaign.id, next);
      toast.success(next === "paused" ? c.paused : c.resumed);
      await load();
    } catch (e: unknown) {
      const msg = formatContentApiError(e, c.statusUpdateError);
      setError(msg);
      toast.error(msg);
    }
  }, [c.paused, c.resumed, c.statusUpdateError, load]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.distribution.deleteCampaign(deleteTarget.id);
      toast.success(c.deleteSuccess);
      setDeleteTarget(null);
      await load();
    } catch (e: unknown) {
      const msg = formatContentApiError(e, c.deleteError);
      toast.error(msg);
    } finally {
      setDeleteLoading(false);
    }
  };

  const columnLabels = useMemo(
    () => ({
      campaignName: c.campaignName,
      strategyType: c.strategyType,
      targeting: c.targeting,
      status: c.statusLabel,
      jobs: c.jobs,
      accounts: c.accounts,
      updated: c.updated,
      actions: c.actions,
      generate: c.generate,
      pause: c.pause,
      resume: c.resume,
      studio: c.studio,
      delete: c.delete,
      content: c.content,
      growth: c.growth,
      engagement: c.engagement,
      noTopic: c.noTopic,
      statusActive: c.statusActive,
      statusPaused: c.statusPaused,
      statusCompleted: c.statusCompleted,
      automationManual: c.automationManual,
      automationAutomated: c.automationAutomated,
    }),
    [c],
  );

  const columns = useMemo(
    () =>
      createCampaignsColumns(
        {
          onGenerate: handleLaunchJobs,
          onToggleStatus: handleToggleStatus,
          onDelete: setDeleteTarget,
          launchingId,
        },
        columnLabels,
      ),
    [columnLabels, launchingId, handleLaunchJobs, handleToggleStatus],
  );

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">{c.engineBadge}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{c.subtitle}</p>
          <p className="text-xs text-muted-foreground">{c.instagramOnly}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} aria-label={c.refresh}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 size-4" />
            {c.createCampaign}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={c.statTotal} value={stats.total} icon={Megaphone} />
        <StatCard title={c.statActive} value={stats.active} icon={CheckCircle2} />
        <StatCard title={c.statPaused} value={stats.paused} icon={PauseCircle} />
        <StatCard title={c.statWithJobs} value={stats.withJobs} icon={Sparkles} />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-5 text-muted-foreground" />
            {c.listTitle}
          </CardTitle>
          <CardDescription>{c.notice}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && campaigns.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-lg border border-dashed px-6 py-12 text-center">
              <Megaphone className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" />
              <p className="font-medium">{c.zeroFlows}</p>
              <p className="mt-1 text-sm text-muted-foreground">{c.zeroFlowsSubtitle}</p>
              <Button className="mt-5" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-1.5 size-4" />
                {c.launchEngine}
              </Button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={campaigns}
              filterColumnId="name"
              filterPlaceholder={c.searchPlaceholder}
              emptyMessage={c.emptyList}
              paginationLabels={text.dataTable}
            />
          )}
        </CardContent>
      </Card>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{c.modalTitle}</DialogTitle>
            <DialogDescription>{c.modalDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campaign-name">{c.campaignName}</Label>
              <Input
                id="campaign-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={c.campaignNamePlaceholder}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{c.strategyType}</Label>
                <Select
                  value={strategyType}
                  onValueChange={(v) => setStrategyType(v as "content" | "growth" | "engagement")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="content">{c.content}</SelectItem>
                    <SelectItem value="growth">{c.growth}</SelectItem>
                    <SelectItem value="engagement">{c.engagement}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-niche">{c.targetNiche}</Label>
                <Input
                  id="campaign-niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder={c.targetNichePlaceholder}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-topic">{c.topic}</Label>
              <Input
                id="campaign-topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={c.topicPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{c.targetAccount} (Instagram)</Label>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border bg-muted/20 p-3">
                {igAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {c.noIgAccounts}{" "}
                    <Link href="/accounts" className="font-medium text-primary underline-offset-2 hover:underline">
                      {c.addIgAccount}
                    </Link>
                    .
                  </p>
                ) : (
                  igAccounts.map((acc) => (
                    <label
                      key={acc.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        className="size-4 rounded border-input"
                        checked={selectedAccounts.includes(acc.id)}
                        onChange={() => toggleAccount(acc.id)}
                      />
                      <span className="font-medium">@{acc.username}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{c.noticeCreate}</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {c.cancel}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={submitting || selectedAccounts.length === 0 || !name.trim() || !topic.trim()}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : c.confirmCreate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={c.deleteTitle}
        description={t("campaigns.deleteDescription", { name: deleteTarget?.name ?? "" })}
        deleteLabel={c.delete}
        cancelLabel={c.cancel}
        onConfirm={handleDeleteConfirm}
        loading={deleteLoading}
      />
    </div>
  );
}
