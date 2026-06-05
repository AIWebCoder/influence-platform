"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

import { PublicationDetailSheet } from "@/components/publications/PublicationDetailSheet";
import { useLocale } from "@/components/i18n/LocaleProvider";
import type { TranslationTree } from "@/lib/i18n";
import { api } from "@/lib/api";
import {
  publicationFromDiagnostics,
  type Publication,
  type PublicationDiagnostics,
  type PublicationStatus,
} from "@/lib/publication-types";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PubText = TranslationTree["publications"];

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

const VALID_PUBLICATION_FILTERS = new Set([
  "published",
  "failed",
  "retrying",
  "pending",
  "permanently_failed",
]);

export default function PublicationsPage() {
  const { locale, text, t } = useLocale();
  const pub = text.publications;
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlStatus = searchParams.get("status")?.trim() ?? "";
  const focusId = searchParams.get("id")?.trim() ?? "";
  const initialFilter = VALID_PUBLICATION_FILTERS.has(urlStatus) ? urlStatus : undefined;

  const [publications, setPublications] = useState<Publication[]>([]);
  const [stats, setStats] = useState<PubStats | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(initialFilter);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [scopeNotice, setScopeNotice] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedPublication, setSelectedPublication] = useState<Publication | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<PublicationDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  /** Prevents ?id= URL effect from re-opening the sheet right after the user closes it. */
  const urlOpenSuppressedRef = useRef(false);

  const LIMIT = 20;
  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const activeFilterTab = activeFilter ?? "all";

  const formatDateForRow = useCallback(
    (dateStr: string | null) => formatDate(dateStr, locale, pub.dash),
    [locale, pub.dash],
  );

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

  const updateUrlId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set("id", id);
      else params.delete("id");
      const q = params.toString();
      router.replace(q ? `/publications?${q}` : "/publications", { scroll: false });
    },
    [router, searchParams],
  );

  const loadDiagnostics = useCallback(
    async (publicationId: string) => {
      setDiagnosticsLoading(true);
      setDiagnosticsError(null);
      try {
        const data = await api.distribution.getPublicationDiagnostics(publicationId);
        setDiagnostics(data);
        setSelectedPublication((prev) => prev ?? publicationFromDiagnostics(data));
      } catch (error: unknown) {
        const err = error as { response?: { data?: { error?: string } } };
        setDiagnosticsError(err?.response?.data?.error || pub.diagFailed);
        setDiagnostics(null);
      } finally {
        setDiagnosticsLoading(false);
      }
    },
    [pub.diagFailed],
  );

  const openPublication = useCallback(
    async (item: Publication) => {
      urlOpenSuppressedRef.current = false;
      setSelectedId(item.id);
      setSelectedPublication(item);
      setSheetOpen(true);
      updateUrlId(item.id);
      await loadDiagnostics(item.id);
    },
    [loadDiagnostics, updateUrlId],
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
        setScopeNotice(
          typeof pubsData.value.scope_notice === "string" ? pubsData.value.scope_notice : null,
        );
      }
      if (statsData.status === "fulfilled") {
        setStats(statsData.value);
        if (
          typeof statsData.value.scope_notice === "string" &&
          statsData.value.scope_notice
        ) {
          setScopeNotice(statsData.value.scope_notice);
        }
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
    const next = VALID_PUBLICATION_FILTERS.has(urlStatus) ? urlStatus : undefined;
    setActiveFilter(next);
    setOffset(0);
  }, [urlStatus]);

  useEffect(() => {
    setOffset(0);
  }, [activeFilter]);

  useEffect(() => {
    if (!focusId) {
      urlOpenSuppressedRef.current = false;
      return;
    }
    if (urlOpenSuppressedRef.current) return;
    if (selectedId === focusId && sheetOpen) return;

    const found = publications.find((p) => p.id === focusId);
    if (found) {
      void openPublication(found);
      return;
    }

    if (loading) return;

    let cancelled = false;
    (async () => {
      setSelectedId(focusId);
      setSheetOpen(true);
      setDiagnostics(null);
      setSelectedPublication(null);
      await loadDiagnostics(focusId);
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, [focusId, publications, loading, openPublication, loadDiagnostics, selectedId, sheetOpen]);

  const notOnCurrentPage = Boolean(
    selectedId && publications.length > 0 && !publications.some((p) => p.id === selectedId),
  );

  const handleSheetOpenChange = (open: boolean) => {
    if (!open) {
      urlOpenSuppressedRef.current = true;
      setSheetOpen(false);
      setSelectedId(null);
      setSelectedPublication(null);
      setDiagnostics(null);
      setDiagnosticsError(null);
      updateUrlId(null);
      return;
    }
    urlOpenSuppressedRef.current = false;
    setSheetOpen(true);
  };

  const handleRetry = async (publicationId: string) => {
    setRetryingId(publicationId);
    try {
      await api.distribution.retryPublication(publicationId);
      await fetchData();
      await loadDiagnostics(publicationId);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      setFetchError(err?.response?.data?.error || pub.retryFailed);
    } finally {
      setRetryingId(null);
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

      {scopeNotice === "NO_PERSONA_ASSIGNMENTS" ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{pub.scopeNoPersonasTitle}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{pub.scopeNoPersonasBody}</p>
            <p className="text-sm">
              <Link href="/users" className="font-medium underline underline-offset-4">
                {pub.scopeNoPersonasUsersLink}
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          title={pub.published}
          value={stats?.published ?? pub.dash}
          icon={CheckCircle2}
          sub={stats ? t("publications.today", { count: stats.published_today }) : undefined}
        />
        <button
          type="button"
          className="text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setActiveFilter("failed")}
        >
          <StatCard
            title={pub.failed}
            value={stats?.failed ?? pub.dash}
            icon={XCircle}
            sub={stats ? t("publications.today", { count: stats.failed_today }) : undefined}
          />
        </button>
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
                {activeFilter === "failed"
                  ? pub.failedEmptyHint
                  : activeFilter
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
                    const isSelected = selectedId === item.id && sheetOpen;
                    return (
                      <TableRow
                        key={item.id}
                        className={cn(
                          "cursor-pointer",
                          isSelected && "bg-muted/60 hover:bg-muted/60",
                        )}
                        aria-selected={isSelected}
                        onClick={() => void openPublication(item)}
                      >
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
                                date: formatDateForRow(item.next_retry_at),
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
                          {formatDateForRow(item.published_at || item.created_at)}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openPublication(item)}
                            disabled={diagnosticsLoading && selectedId === item.id}
                          >
                            {diagnosticsLoading && selectedId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              pub.details
                            )}
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

      <PublicationDetailSheet
        publication={selectedPublication}
        diagnostics={diagnostics}
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        loading={diagnosticsLoading}
        error={diagnosticsError}
        notOnCurrentPage={notOnCurrentPage}
        onRetry={handleRetry}
        retrying={retryingId === selectedId}
        formatDate={formatDateForRow}
      />
    </div>
  );
}
