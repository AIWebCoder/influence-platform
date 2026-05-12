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

const FILTER_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Published", value: "published" },
  { label: "Failed", value: "failed" },
  { label: "Retrying", value: "retrying" },
  { label: "Pending", value: "pending" },
  { label: "Perm. Failed", value: "permanently_failed" },
];

function formatDate(dateStr: string | null) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string | null, len: number) {
  if (!str) return "-";
  return str.length > len ? `${str.slice(0, len)}...` : str;
}

function statusMeta(status: PublicationStatus) {
  switch (status) {
    case "published":
      return {
        label: "Published",
        variant: "default" as const,
        icon: CheckCircle2,
      };
    case "failed":
      return {
        label: "Failed",
        variant: "destructive" as const,
        icon: XCircle,
      };
    case "permanently_failed":
      return {
        label: "Perm. Failed",
        variant: "secondary" as const,
        icon: AlertCircle,
      };
    case "retrying":
      return {
        label: "Retrying",
        variant: "outline" as const,
        icon: RotateCw,
      };
    case "publishing":
      return {
        label: "Publishing",
        variant: "outline" as const,
        icon: Zap,
      };
    default:
      return {
        label: "Pending",
        variant: "secondary" as const,
        icon: Clock,
      };
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
  const { text } = useLocale();
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
        (res) => res.status === "rejected"
      );
      if (rejectedRequests.length === 3) {
        setFetchError("Unable to load publication data. Check backend services and retry.");
      } else if (rejectedRequests.length > 0) {
        setFetchError("Some publication metrics are temporarily unavailable.");
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
      setFetchError("Unexpected error while loading publications.");
    } finally {
      setLoading(false);
    }
  }, [activeFilter, offset]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    setOffset(0);
  }, [activeFilter]);

  const canRetry = useMemo(
    () => (pub: Publication) => {
      if (!["failed", "permanently_failed", "retrying"].includes(pub.status)) return false;
      if (pub.publication_target_id) return true;
      return Number(pub.retry_count || 0) < Number(pub.max_retries || 3);
    },
    []
  );

  const handleRetry = async (publicationId: string) => {
    setRetryingId(publicationId);
    try {
      await api.distribution.retryPublication(publicationId);
      await fetchData();
    } catch (error: any) {
      setFetchError(error?.response?.data?.error || "Retry action failed.");
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
    } catch (error: any) {
      setDiagError(error?.response?.data?.error || "Could not load diagnostics.");
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
            {text.publications.title}
          </h2>
          <p className="text-sm text-muted-foreground">{text.publications.subtitle}</p>
        </div>
        <Button onClick={fetchData} disabled={loading} variant="outline">
          <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
          {text.publications.syncStatus}
        </Button>
      </div>

      {fetchError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Data Load Error</AlertTitle>
          <AlertDescription>{fetchError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title="Published"
          value={stats?.published ?? "-"}
          icon={CheckCircle2}
          sub={stats ? `${stats.published_today} today` : undefined}
        />
        <StatCard
          title="Failed"
          value={stats?.failed ?? "-"}
          icon={XCircle}
          sub={stats ? `${stats.failed_today} today` : undefined}
        />
        <StatCard
          title="Retrying"
          value={stats?.retrying ?? "-"}
          icon={RotateCw}
          sub={stats ? `${stats.total_retries} total retries` : undefined}
        />
        <StatCard
          title="Queue Pending"
          value={queueStats?.queue?.pending ?? "-"}
          icon={Inbox}
          sub={queueStats ? `${queueStats.queue.delayed} delayed` : undefined}
        />
        <StatCard
          title="Total"
          value={stats?.total ?? "-"}
          icon={TrendingUp}
          sub={stats ? `${stats.processing} processing` : undefined}
        />
      </div>

      <Tabs
        value={activeFilterTab}
        onValueChange={(value) => setActiveFilter(value === "all" ? undefined : value)}
        className="w-fit max-w-full"
      >
        <TabsList className="w-fit max-w-full justify-start overflow-x-auto">
          {FILTER_OPTIONS.map((filter) => {
            const tabValue = filter.value ?? "all";
            return (
              <TabsTrigger key={filter.label} value={tabValue}>
                {filter.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Publication Queue</CardTitle>
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
              <p className="font-medium">No publications found</p>
              <p className="text-sm">
                {activeFilter
                  ? `No publications with status "${activeFilter}"`
                  : "Publications will appear here once content is published"}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Content</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Retries</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead>Timeline</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {publications.map((pub) => {
                    const meta = statusMeta(pub.status);
                    const Icon = meta.icon;
                    return (
                      <TableRow key={pub.id}>
                        <TableCell>
                          <div className="font-medium">@{pub.account_username}</div>
                          <div className="text-xs text-muted-foreground">{pub.account_platform}</div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[260px]">
                            <p className="truncate">{truncate(pub.content_caption, 80)}</p>
                            <p className="text-xs text-muted-foreground">
                              {pub.content_type
                                ? `${pub.content_type}${pub.content_niche ? ` · ${pub.content_niche}` : ""}`
                                : "-"}
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
                          <div className="text-sm">{pub.retry_count}/{pub.max_retries || 3}</div>
                          {pub.next_retry_at ? (
                            <p className="text-xs text-muted-foreground">
                              next: {formatDate(pub.next_retry_at)}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[280px]">
                          {pub.error_message ? (
                            <div>
                              <p className="text-sm text-destructive truncate">
                                {truncate(pub.error_message, 90)}
                              </p>
                              {pub.failure_type ? (
                                <p className="text-xs text-muted-foreground uppercase">
                                  {pub.failure_type}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>{formatDate(pub.published_at || pub.created_at)}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleViewDiagnostics(pub.id)}
                            disabled={diagLoadingId === pub.id}
                          >
                            {diagLoadingId === pub.id ? "Loading..." : "Details"}
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRetry(pub.id)}
                            disabled={!canRetry(pub) || retryingId === pub.id}
                          >
                            {retryingId === pub.id ? "Retrying..." : "Retry"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Showing {offset + 1}-{Math.min(offset + LIMIT, total)} of {total}
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
                    {currentPage} / {Math.max(totalPages, 1)}
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
          <AlertTitle>Diagnostics Error</AlertTitle>
          <AlertDescription>{diagError}</AlertDescription>
        </Alert>
      ) : null}

      {diag ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Diagnostics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground break-all">{diag.id}</p>
            <Separator />
            <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <p>status: <span className="font-medium">{diag.status}</span></p>
              <p>attempt: <span className="font-medium">{diag.attempt}</span></p>
              <p>retry_count: <span className="font-medium">{diag.retry_count}</span></p>
              <p>max_retries: <span className="font-medium">{diag.max_retries}</span></p>
              <p>last_retry_at: <span className="font-medium">{formatDate(diag.last_retry_at)}</span></p>
              <p>next_retry_at: <span className="font-medium">{formatDate(diag.next_retry_at)}</span></p>
              <p>failure_type: <span className="font-medium">{diag.failure_type || "-"}</span></p>
              <p>error: <span className="font-medium">{diag.error_message || "-"}</span></p>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
