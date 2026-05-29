"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
  Loader2,
  RefreshCw,
  RotateCw,
  Search,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
import type { TranslationTree } from "@/lib/i18n";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PublicationStatus =
  | "published"
  | "failed"
  | "permanently_failed"
  | "retrying"
  | "pending"
  | "publishing";

type PubText = TranslationTree["publications"];

interface Publication {
  id: string;
  content_id: string | null;
  publication_target_id?: string | null;
  status: PublicationStatus;
  post_url: string | null;
  published_at: string | null;
  error_message: string | null;
  retry_count: number;
  attempt?: number;
  failure_type: string | null;
  last_retry_at: string | null;
  next_retry_at?: string | null;
  max_retries: number;
  engagement_score: number | null;
  created_at: string;
  updated_at: string;
  account_username: string;
  account_platform: string;
  content_caption: string | null;
  content_type: string | null;
  content_niche: string | null;
}

interface PubStats {
  total: number;
  pending: number;
  processing: number;
  published: number;
  failed: number;
  retrying: number;
  total_retries: number;
  published_today: number;
  failed_today: number;
}

interface QueueStats {
  queue: { pending: number; delayed: number };
  publications: {
    total: number;
    pending: number;
    processing: number;
    published: number;
    failed: number;
    retrying: number;
    total_retries: number;
  };
}

interface PublicationDiagnostics {
  id: string;
  status: string;
  error_message: string | null;
  failure_type: string | null;
  retry_count: number;
  max_retries: number;
  attempt: number;
  last_retry_at: string | null;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  post_url: string | null;
  account_id: string;
  account_username: string;
  content_id: string | null;
  content_type: string | null;
  content_niche: string | null;
  content_caption: string | null;
}

function formatDate(dateStr: string | null, locale: string, dash: string) {
  if (!dateStr) return dash;
  const d = new Date(dateStr);
  return d.toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string | null, len: number, dash: string) {
  if (!str) return dash;
  return str.length > len ? `${str.slice(0, len)}...` : str;
}

function statusMeta(status: PublicationStatus, pub: PubText) {
  switch (status) {
    case "published":
      return { label: pub.published, variant: "default" as const, icon: CheckCircle2 };
    case "failed":
      return { label: pub.failed, variant: "destructive" as const, icon: XCircle };
    case "permanently_failed":
      return { label: pub.permDead, variant: "secondary" as const, icon: AlertCircle };
    case "retrying":
      return { label: pub.retrying, variant: "outline" as const, icon: RotateCw };
    case "publishing":
      return { label: pub.publishing, variant: "outline" as const, icon: Zap };
    default:
      return { label: pub.pending, variant: "secondary" as const, icon: Clock };
  }
}

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
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
            {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
          </div>
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PublicationsPage() {
  const { locale, text, t } = useLocale();
  const pub = text.publications;
  const [publications, setPublications] = useState<Publication[]>([]);
  const [stats, setStats] = useState<PubStats | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [diagLoadingId, setDiagLoadingId] = useState<string | null>(null);
  const [diag, setDiag] = useState<PublicationDiagnostics | null>(null);
  const [diagError, setDiagError] = useState<string | null>(null);

  const LIMIT = 20;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const activeFilterTab = activeFilter ?? "all";

  const filterOptions = useMemo(
    () => [
      { label: pub.filterAll, value: undefined },
      { label: pub.filterPublished, value: "published" },
      { label: pub.filterFailed, value: "failed" },
      { label: pub.filterRetrying, value: "retrying" },
      { label: pub.filterPending, value: "pending" },
      { label: pub.filterPermFailed, value: "permanently_failed" },
    ],
    [pub],
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [pubsData, statsData, queueData] = await Promise.allSettled([
        api.distribution.getPublications(activeFilter, LIMIT, offset),
        api.distribution.getPublicationStats(),
        api.distribution.getQueueStats(),
      ]);
      const rejectedRequests = [pubsData, statsData, queueData].filter(
        (res) => res.status === "rejected",
      );
      if (rejectedRequests.length === 3) {
        setFetchError(pub.loadErrorAll);
      } else if (rejectedRequests.length > 0) {
        setFetchError(pub.loadErrorPartial);
      }

      if (pubsData.status === "fulfilled") {
        setPublications(pubsData.value.publications || []);
        setTotal(pubsData.value.pagination?.total || 0);
      }
      if (statsData.status === "fulfilled") {
        setStats(statsData.value);
      }
      if (queueData.status === "fulfilled") {
        setQueueStats(queueData.value);
      }
    } catch {
      setFetchError(pub.loadErrorUnexpected);
    } finally {
      setLoading(false);
    }
  }, [activeFilter, offset, pub.loadErrorAll, pub.loadErrorPartial, pub.loadErrorUnexpected]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    setOffset(0);
  }, [activeFilter]);

  const canRetry = useMemo(
    () => (item: Publication) => {
      if (!["failed", "permanently_failed", "retrying"].includes(item.status)) return false;
      if (item.publication_target_id) return true;
      return Number(item.retry_count || 0) < Number(item.max_retries || 3);
    },
    [],
  );

  const handleRetry = async (publicationId: string) => {
    setRetryingId(publicationId);
    try {
      await api.distribution.retryPublication(publicationId);
      await fetchData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setFetchError(err?.response?.data?.error || pub.retryFailed);
    } finally {
      setRetryingId(null);
    }
  };

  const handleViewDiagnostics = async (publicationId: string) => {
    setDiagLoadingId(publicationId);
    setDiagError(null);
    try {
      const data = await api.distribution.getPublicationDiagnostics(publicationId);
      setDiag(data);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setDiagError(err?.response?.data?.error || pub.diagFailed);
      setDiag(null);
    } finally {
      setDiagLoadingId(null);
    }
  };

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            {pub.title}
          </h2>
          <p className="text-sm text-muted-foreground">{pub.subtitle}</p>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline">
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          {pub.syncStatus}
        </Button>
      </div>

      {fetchError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{pub.dataLoadError}</AlertTitle>
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title={pub.published}
          value={stats?.published ?? pub.dash}
          icon={CheckCircle2}
          sub={stats ? t("publications.today", { count: stats.published_today }) : undefined}
        />
        <StatCard
          title={pub.failed}
          value={stats?.failed ?? pub.dash}
          icon={XCircle}
          sub={stats ? t("publications.today", { count: stats.failed_today }) : undefined}
        />
        <StatCard
          title={pub.retrying}
          value={stats?.retrying ?? pub.dash}
          icon={RotateCw}
          sub={stats ? t("publications.totalRetries", { count: stats.total_retries }) : undefined}
        />
        <StatCard
          title={pub.queuePending}
          value={queueStats?.queue?.pending ?? pub.dash}
          icon={Inbox}
          sub={
            queueStats ? t("publications.delayed", { count: queueStats.queue.delayed }) : undefined
          }
        />
        <StatCard
          title={pub.total}
          value={stats?.total ?? pub.dash}
          icon={TrendingUp}
          sub={stats ? t("publications.processing", { count: stats.processing }) : undefined}
        />
      </div>

      <Tabs
        value={activeFilterTab}
        onValueChange={(value) => setActiveFilter(value === "all" ? undefined : value)}
        className="w-fit max-w-full"
      >
        <TabsList className="w-fit max-w-full justify-start overflow-x-auto">
          {filterOptions.map((filter) => {
            const tabValue = filter.value ?? "all";
            return (
              <TabsTrigger key={tabValue} value={tabValue}>
                {filter.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{pub.queueTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && publications.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : publications.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Inbox className="h-8 w-8 mx-auto mb-2" />
              <p className="font-medium">{pub.noPublications}</p>
              <p className="text-sm">
                {activeFilter
                  ? t("publications.noStatusPublications", { status: activeFilter })
                  : pub.emptyHint}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{pub.account}</TableHead>
                    <TableHead>{pub.content}</TableHead>
                    <TableHead>{pub.status}</TableHead>
                    <TableHead>{pub.retries}</TableHead>
                    <TableHead>{pub.errorLog}</TableHead>
                    <TableHead>{pub.timeline}</TableHead>
                    <TableHead className="text-right">{pub.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {publications.map((item) => {
                    const meta = statusMeta(item.status, pub);
                    const Icon = meta.icon;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">@{item.account_username}</div>
                          <div className="text-xs text-muted-foreground">{item.account_platform}</div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[260px]">
                            <p className="truncate">{truncate(item.content_caption, 80, pub.dash)}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.content_type
                                ? `${item.content_type}${item.content_niche ? ` · ${item.content_niche}` : ""}`
                                : pub.dash}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant} className="gap-1">
                            <Icon className="h-3.5 w-3.5" />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {item.retry_count}/{item.max_retries || 3}
                          </div>
                          {item.next_retry_at ? (
                            <p className="text-xs text-muted-foreground">
                              {t("publications.nextRetry", {
                                date: formatDate(item.next_retry_at, locale, pub.dash),
                              })}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          {item.error_message ? (
                            <div>
                              <p className="text-sm text-destructive truncate">
                                {truncate(item.error_message, 90, pub.dash)}
                              </p>
                              {item.failure_type ? (
                                <p className="text-xs text-muted-foreground uppercase">
                                  {item.failure_type}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{pub.dash}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {formatDate(item.published_at || item.created_at, locale, pub.dash)}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDiagnostics(item.id)}
                            disabled={diagLoadingId === item.id}
                          >
                            {diagLoadingId === item.id ? pub.loading : pub.details}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRetry(item.id)}
                            disabled={!canRetry(item) || retryingId === item.id}
                          >
                            {retryingId === item.id ? pub.retryingAction : pub.retry}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {t("publications.showing", {
                    start: offset + 1,
                    end: Math.min(offset + LIMIT, total),
                    total,
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={currentPage <= 1}
                    onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">
                    {t("publications.pageOf", {
                      current: currentPage,
                      total: Math.max(totalPages, 1),
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={currentPage >= totalPages}
                    onClick={() => setOffset(offset + LIMIT)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {diagError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{pub.diagErrorTitle}</AlertTitle>
          <AlertDescription>{diagError}</AlertDescription>
        </Alert>
      ) : null}

      {diag ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              {pub.diagnostics}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground break-all">{diag.id}</p>
            <Separator />
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <p>
                {pub.status}: <span className="font-medium">{diag.status}</span>
              </p>
              <p>
                {pub.retries}: <span className="font-medium">{diag.retry_count}</span>
              </p>
              <p>
                max: <span className="font-medium">{diag.max_retries}</span>
              </p>
              <p>
                attempt: <span className="font-medium">{diag.attempt}</span>
              </p>
              <p>
                last:{" "}
                <span className="font-medium">
                  {formatDate(diag.last_retry_at, locale, pub.dash)}
                </span>
              </p>
              <p>
                next:{" "}
                <span className="font-medium">
                  {formatDate(diag.next_retry_at, locale, pub.dash)}
                </span>
              </p>
              <p>
                failure_type: <span className="font-medium">{diag.failure_type || pub.dash}</span>
              </p>
              <p>
                error: <span className="font-medium">{diag.error_message || pub.dash}</span>
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
