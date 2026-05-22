"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, RefreshCw, ShieldAlert, Users, Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PublicationStats = {
  published: number;
  failed: number;
  retrying: number;
  published_today: number;
  failed_today: number;
};

type QueueStats = {
  queue: {
    pending: number;
    delayed: number;
    publish_commands_pending?: number;
  };
};

type Account = {
  status?: string;
  health_score?: number | null;
};

function severityBadge(
  value: "low" | "medium" | "high",
  labels: { critical: string; watch: string; healthy: string }
) {
  if (value === "high") return <Badge variant="destructive">{labels.critical}</Badge>;
  if (value === "medium") return <Badge variant="outline">{labels.watch}</Badge>;
  return <Badge variant="secondary">{labels.healthy}</Badge>;
}

export default function DashboardPage() {
  const { text, t } = useLocale();
  const o = text.operations;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  const [stats, setStats] = useState<PublicationStats>({
    published: 0,
    failed: 0,
    retrying: 0,
    published_today: 0,
    failed_today: 0,
  });
  const [queue, setQueue] = useState<QueueStats>({ queue: { pending: 0, delayed: 0 } });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [contentQueue, setContentQueue] = useState(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [publicationStats, queueStats, accountsData, contentQueueRes] = await Promise.all([
        api.distribution.getPublicationStats() as Promise<PublicationStats>,
        api.distribution.getQueueStats() as Promise<QueueStats>,
        api.distribution.getAccounts() as Promise<Account[]>,
        api.content.getQueueSize() as Promise<{ size?: number }>,
      ]);
      setStats(publicationStats);
      setQueue(queueStats);
      setAccounts(accountsData);
      setContentQueue(Number(contentQueueRes?.size ?? 0));
      setUpdatedAt(new Date().toISOString());
    } catch {
      setError(o.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const active = useMemo(
    () => accounts.filter((a) => (a.status ?? "").toUpperCase() === "ACTIVE").length,
    [accounts]
  );
  const warming = useMemo(
    () => accounts.filter((a) => (a.status ?? "").toUpperCase() === "WARMING").length,
    [accounts]
  );
  const lowHealth = useMemo(
    () => accounts.filter((a) => Number(a.health_score ?? 0) < 50).length,
    [accounts]
  );

  const successRate = useMemo(() => {
    const total = stats.published + stats.failed;
    return total > 0 ? Math.round((stats.published / total) * 100) : 100;
  }, [stats.failed, stats.published]);

  const queuePressure = useMemo(
    () => Number(queue.queue.publish_commands_pending ?? 0) + Number(queue.queue.delayed ?? 0),
    [queue.queue.delayed, queue.queue.publish_commands_pending]
  );

  const readiness = useMemo(() => {
    if (accounts.length === 0) return 0;
    return Math.round(((active + warming) / accounts.length) * 100);
  }, [accounts.length, active, warming]);

  const incidents = useMemo(() => {
    const list: string[] = [];
    if (successRate < 80) list.push(t("operations.incidentLowPublish", { rate: successRate }));
    if (queuePressure > 50) list.push(t("operations.incidentQueuePressure", { count: queuePressure }));
    if (stats.retrying > 20) list.push(t("operations.incidentRetrying", { count: stats.retrying }));
    return list;
  }, [queuePressure, stats.retrying, successRate, t]);

  const refreshedAt = updatedAt ? new Date(updatedAt).toLocaleTimeString() : "-";

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{o.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("operations.subtitle", { time: refreshedAt })}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
          disabled={refreshing}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? o.refreshing : o.refresh}
        </Button>
        {loading ? <Badge variant="outline">{o.loading}</Badge> : null}
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5" />
            {error}
          </CardContent>
        </Card>
      ) : null}

      {incidents.length > 0 ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6">
            <p className="text-sm font-medium mb-2">{o.attentionTitle}</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {incidents.map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{o.publishSuccess}</p>
                <p className="text-2xl font-semibold mt-1">{successRate}%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("operations.todayStats", {
                    published: stats.published_today,
                    failed: stats.failed_today,
                  })}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                {severityBadge(successRate < 80 ? "high" : successRate < 90 ? "medium" : "low", {
                  critical: o.badgeCritical,
                  watch: o.badgeWatch,
                  healthy: o.badgeHealthy,
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{o.queuePressure}</p>
                <p className="text-2xl font-semibold mt-1">{queuePressure}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("operations.pendingDelayed", {
                    pending: queue.queue.pending,
                    delayed: queue.queue.delayed,
                  })}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Workflow className="h-5 w-5 text-muted-foreground" />
                {severityBadge(queuePressure > 50 ? "high" : queuePressure > 25 ? "medium" : "low", {
                  critical: o.badgeCritical,
                  watch: o.badgeWatch,
                  healthy: o.badgeHealthy,
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{o.accountReadiness}</p>
                <p className="text-2xl font-semibold mt-1">{readiness}%</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("operations.activeWarmingLowHealth", { active, warming, lowHealth })}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Users className="h-5 w-5 text-muted-foreground" />
                {severityBadge(readiness < 50 ? "high" : readiness < 70 ? "medium" : "low", {
                  critical: o.badgeCritical,
                  watch: o.badgeWatch,
                  healthy: o.badgeHealthy,
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">{o.retryingRisk}</p>
                <p className="text-2xl font-semibold mt-1">{stats.retrying}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("operations.failedPublicationsCount", { count: stats.failed })}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                {severityBadge(stats.retrying > 20 ? "high" : stats.retrying > 10 ? "medium" : "low", {
                  critical: o.badgeCritical,
                  watch: o.badgeWatch,
                  healthy: o.badgeHealthy,
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{o.actionQueue}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{o.item}</TableHead>
                <TableHead className="text-right">{o.count}</TableHead>
                <TableHead className="text-right">{o.open}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{o.failedPublications}</TableCell>
                <TableCell className="text-right">{stats.failed}</TableCell>
                <TableCell className="text-right">
                  <Link className="underline underline-offset-2" href="/publications?status=failed">
                    {o.open}
                  </Link>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{o.retryingPublications}</TableCell>
                <TableCell className="text-right">{stats.retrying}</TableCell>
                <TableCell className="text-right">
                  <Link className="underline underline-offset-2" href="/publications?status=retrying">
                    {o.open}
                  </Link>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{o.contentQueue}</TableCell>
                <TableCell className="text-right">{contentQueue}</TableCell>
                <TableCell className="text-right">
                  <Link className="underline underline-offset-2" href="/generation-studio">
                    {o.open}
                  </Link>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{o.lowHealthAccounts}</TableCell>
                <TableCell className="text-right">{lowHealth}</TableCell>
                <TableCell className="text-right">
                  <Link className="underline underline-offset-2" href="/accounts">
                    {o.open}
                  </Link>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/accounts" className="rounded-md border p-4 hover:bg-muted/50">
          <p className="font-medium">{o.quickAccounts}</p>
          <p className="text-xs text-muted-foreground">{o.quickAccountsDesc}</p>
        </Link>
        <Link href="/generation-studio" className="rounded-md border p-4 hover:bg-muted/50">
          <p className="font-medium">{o.quickGeneration}</p>
          <p className="text-xs text-muted-foreground">{o.quickGenerationDesc}</p>
        </Link>
        <Link href="/publications" className="rounded-md border p-4 hover:bg-muted/50">
          <p className="font-medium">{o.quickPublications}</p>
          <p className="text-xs text-muted-foreground">{o.quickPublicationsDesc}</p>
        </Link>
        <Link href="/emulators" className="rounded-md border p-4 hover:bg-muted/50">
          <p className="font-medium">{o.quickEmulators}</p>
          <p className="text-xs text-muted-foreground">{o.quickEmulatorsDesc}</p>
        </Link>
      </div>
    </div>
  );
}
