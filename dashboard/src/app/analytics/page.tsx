"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, RefreshCw, TrendingUp } from "lucide-react";

import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  published_7d?: number;
  failed_7d?: number;
};

type OpsSummary = {
  generated_at?: string;
  publication_windows?: {
    last_15m?: { published: number; failed: number; permanently_failed: number };
    last_1h?: { published: number; failed: number; permanently_failed: number };
  };
  queue?: {
    content_ready: number;
    publish_commands_pending: number;
    publish_delayed: number;
    publish_failed_dlq: number;
  };
  accounts?: { total: number; active: number; warming: number; low_health: number };
  failure_breakdown?: Array<{ failure_type: string; total: number }>;
  proxy_capacity?: {
    unassigned_active?: number;
    slots_available?: number;
    strict_one_to_one?: boolean;
  } | null;
};

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<PublicationStats | null>(null);
  const [ops, setOps] = useState<OpsSummary | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [publicationStats, opsSummary] = await Promise.all([
        api.distribution.getPublicationStats() as Promise<PublicationStats>,
        api.distribution.getOpsSummary() as Promise<OpsSummary>,
      ]);
      setStats(publicationStats);
      setOps(opsSummary);
    } catch {
      setError("Unable to load analytics from Distribution Engine APIs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const published7d = stats?.published_7d ?? 0;
  const failed7d = stats?.failed_7d ?? 0;
  const success7d = useMemo(() => {
    const total = published7d + failed7d;
    return total > 0 ? Math.round((published7d / total) * 100) : 100;
  }, [failed7d, published7d]);

  const last1h = ops?.publication_windows?.last_1h;
  const refreshedAt = ops?.generated_at
    ? new Date(ops.generated_at).toLocaleString()
    : "—";

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="page-title flex items-center gap-3 text-zinc-900 dark:text-zinc-50">
            <BarChart3 className="h-9 w-9 text-indigo-500" />
            Analytics
          </h2>
          <p className="page-subtitle">
            Seven-day publish summary and live ops windows (V1 light).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void load();
          }}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 pt-6 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Published (7 days)</CardDescription>
            <CardTitle className="text-3xl">{loading ? "—" : published7d}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
            {loading ? "Loading…" : `${success7d}% success vs failures in window`}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed (7 days)</CardDescription>
            <CardTitle className="text-3xl">{loading ? "—" : failed7d}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Today: {loading ? "—" : `${stats?.failed_today ?? 0} failed / ${stats?.published_today ?? 0} published`}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last hour</CardDescription>
            <CardTitle className="text-3xl">{loading ? "—" : (last1h?.published ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : `${last1h?.failed ?? 0} failed · ${last1h?.permanently_failed ?? 0} permanent`}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Retrying now</CardDescription>
            <CardTitle className="text-3xl">{loading ? "—" : (stats?.retrying ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Total published (all time): {loading ? "—" : (stats?.published ?? 0)}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Queues</CardTitle>
            <CardDescription>Redis-backed publish pipeline</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Publish commands pending</span>
              <span className="font-medium">{ops?.queue?.publish_commands_pending ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Content ready (legacy)</span>
              <span className="font-medium">{ops?.queue?.content_ready ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Delayed / DLQ</span>
              <span className="font-medium">
                {ops?.queue?.publish_delayed ?? "—"} / {ops?.queue?.publish_failed_dlq ?? "—"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accounts & proxies</CardTitle>
            <CardDescription>Capacity for scale-out</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Active / warming</span>
              <span className="font-medium">
                {ops?.accounts?.active ?? "—"} / {ops?.accounts?.warming ?? "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Low health</span>
              <span className="font-medium">{ops?.accounts?.low_health ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Proxy slots available</span>
              <span className="font-medium">
                {ops?.proxy_capacity?.slots_available ?? "—"}
                {ops?.proxy_capacity?.strict_one_to_one ? (
                  <Badge variant="outline" className="ml-2 text-xs">
                    1:1
                  </Badge>
                ) : null}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Failure breakdown</CardTitle>
          <CardDescription>Top failure types in retry/failed backlog · updated {refreshedAt}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (ops?.failure_breakdown?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No failures in the current backlog window.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ops?.failure_breakdown?.map((row) => (
                  <TableRow key={row.failure_type}>
                    <TableCell className="font-mono text-xs">{row.failure_type}</TableCell>
                    <TableCell className="text-right">{row.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        <Activity className="mr-1 inline h-4 w-4" />
        Drill down in{" "}
        <Link href="/publications" className="text-primary underline-offset-4 hover:underline">
          Publications
        </Link>{" "}
        or the{" "}
        <Link href="/" className="text-primary underline-offset-4 hover:underline">
          Operations dashboard
        </Link>
        .
      </p>
    </div>
  );
}