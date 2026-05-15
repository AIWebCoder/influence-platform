"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Loader2, Pause, Play, Plus, RefreshCw } from "lucide-react";

import { api, type CampaignRecord } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type IgAccount = { id: string; username: string; platform?: string | null };

export default function CampaignsPage() {
  const { text } = useLocale();
  const t = text.campaigns;
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [accounts, setAccounts] = useState<IgAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [niche, setNiche] = useState("fitness");
  const [topic, setTopic] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);

  const igAccounts = useMemo(
    () => accounts.filter((a) => (a.platform || "instagram").toLowerCase() === "instagram"),
    [accounts],
  );

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
      setError(t.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.loadError]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleAccount = (id: string) => {
    setSelectedAccounts((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const handleCreate = async () => {
    if (!name.trim() || selectedAccounts.length === 0 || !topic.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.distribution.createCampaign({
        name: name.trim(),
        type: "content",
        target_niche: niche.trim(),
        target_account_id: selectedAccounts.length === 1 ? selectedAccounts[0] : null,
        settings: {
          topic: topic.trim(),
          account_ids: selectedAccounts,
          generation_job_ids: [],
        },
      });
      setSuccess(t.launchSuccess);
      setDialogOpen(false);
      setName("");
      setTopic("");
      setSelectedAccounts([]);
      await load();
    } catch {
      setError(t.launchError);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLaunchJobs = async (campaign: CampaignRecord) => {
    const settings = campaign.settings || {};
    const accountIds: string[] =
      Array.isArray(settings.account_ids) && settings.account_ids.length > 0
        ? settings.account_ids
        : campaign.target_account_id
          ? [campaign.target_account_id]
          : [];
    const campaignTopic = String(settings.topic || campaign.target_niche || niche);
    if (accountIds.length === 0) {
      setError("No Instagram accounts linked to this campaign.");
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
      setSuccess(`${t.launchSuccess} (${jobIds.length} jobs)`);
      await load();
    } catch {
      setError(t.launchError);
    } finally {
      setLaunchingId(null);
    }
  };

  const handleStatus = async (campaign: CampaignRecord, status: string) => {
    try {
      await api.distribution.updateCampaignStatus(campaign.id, status);
      setSuccess(status === "paused" ? t.paused : t.resumed);
      await load();
    } catch {
      setError(t.statusUpdateError);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-primary">{t.engineBadge}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
          <p className="text-sm text-muted-foreground">{t.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">V1: Instagram only · strict 1:1 proxy per account</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1 size-4" />
            {t.launch}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-5" />
            {t.title}
          </CardTitle>
          <CardDescription>{t.notice}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="font-medium">{t.zeroFlows}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t.zeroFlowsSubtitle}</p>
              <Button className="mt-4" onClick={() => setDialogOpen(true)}>
                {t.launchEngine}
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.campaignName}</TableHead>
                  <TableHead>{t.strategyType}</TableHead>
                  <TableHead>{t.targeting}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const jobIds = (c.settings?.generation_job_ids as string[] | undefined) || [];
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{c.type}</Badge>
                      </TableCell>
                      <TableCell>
                        {c.target_niche || "—"}
                        {jobIds.length > 0 ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({jobIds.length} jobs)
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.status === "active" ? "default" : "outline"}>{c.status}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          size="sm"
                          variant="default"
                          disabled={launchingId === c.id || c.status === "paused"}
                          onClick={() => handleLaunchJobs(c)}
                        >
                          {launchingId === c.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <>
                              <Play className="mr-1 size-3" />
                              Generate
                            </>
                          )}
                        </Button>
                        {c.status === "active" ? (
                          <Button size="sm" variant="outline" onClick={() => handleStatus(c, "paused")}>
                            <Pause className="mr-1 size-3" />
                            {t.pause}
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => handleStatus(c, "active")}>
                            {t.resume}
                          </Button>
                        )}
                        {jobIds[0] ? (
                          <Button size="sm" variant="ghost" asChild>
                            <Link href={`/generation-studio?job=${jobIds[jobIds.length - 1]}`}>Studio</Link>
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.modalTitle}</DialogTitle>
            <DialogDescription>{t.modalDescription}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t.campaignName}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.campaignNamePlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label>{t.targetNiche}</Label>
              <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder={t.targetNichePlaceholder} />
            </div>
            <div className="space-y-2">
              <Label>Topic</Label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Reel topic for generation" />
            </div>
            <div className="space-y-2">
              <Label>{t.targetAccount} (Instagram)</Label>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2">
                {igAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No Instagram accounts.{" "}
                    <Link href="/accounts" className="text-primary underline">
                      Add one
                    </Link>
                    .
                  </p>
                ) : (
                  igAccounts.map((acc) => (
                    <label key={acc.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(acc.id)}
                        onChange={() => toggleAccount(acc.id)}
                      />
                      @{acc.username}
                    </label>
                  ))
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t.notice}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t.cancel}
            </Button>
            <Button onClick={handleCreate} disabled={submitting || selectedAccounts.length === 0}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : t.confirmLaunch}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}