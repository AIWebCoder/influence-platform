"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  AlertTriangle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Zap,
  TrendingUp,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { StatusBadge } from "@/components/ui/StatusBadge";

type PublicationStatus =
  | "published"
  | "failed"
  | "permanently_failed"
  | "retrying"
  | "pending"
  | "publishing";

interface Publication {
  id: string;
  content_id: string;
  status: PublicationStatus;
  post_url: string | null;
  published_at: string | null;
  error_message: string | null;
  retry_count: number;
  failure_type: string | null;
  last_retry_at: string | null;
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

const STATUS_CONFIG: Record<
  PublicationStatus,
  { label: string; color: string; bg: string; icon: React.ElementType }
> = {
  published: {
    label: "Published",
    color: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    color: "text-red-700 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-500/10 border-red-100 dark:border-red-500/20",
    icon: XCircle,
  },
  permanently_failed: {
    label: "Perm. Dead",
    color: "text-zinc-900 dark:text-zinc-100",
    bg: "bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700",
    icon: AlertTriangle,
  },
  retrying: {
    label: "Retrying",
    color: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20",
    icon: RotateCw,
  },
  pending: {
    label: "Pending",
    color: "text-blue-700 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-500/10 border-blue-100 dark:border-blue-500/20",
    icon: Clock,
  },
  publishing: {
    label: "Publishing",
    color: "text-indigo-700 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20",
    icon: Zap,
  },
};

const FILTER_OPTIONS: { label: string; value: string | undefined }[] = [
  { label: "All", value: undefined },
  { label: "Published", value: "published" },
  { label: "Failed", value: "failed" },
  { label: "Retrying", value: "retrying" },
  { label: "Pending", value: "pending" },
  { label: "Perm. Failed", value: "permanently_failed" },
];

function mapPublicationStatusToVariant(status: PublicationStatus): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "published": return "success";
    case "failed": return "danger";
    case "permanently_failed": return "neutral";
    case "retrying": return "warning";
    case "pending": return "neutral";
    case "publishing": return "neutral";
    default: return "neutral";
  }
}

function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const variant = mapPublicationStatusToVariant(status);
  
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-badge)] text-[10px] font-medium uppercase tracking-widest border"
    >
      <Icon className={cn("w-3.5 h-3.5", status === "publishing" && "animate-pulse")} />
      <StatusBadge variant={variant} label={config.label} />
    </span>
  );
}

function StatsCard({
  title,
  value,
  icon: Icon,
  accent,
  subtitle,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  accent: string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm hover:shadow-xl hover:shadow-zinc-500/5 transition-all">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{title}</p>
          <p className={`text-3xl font-black mt-2 font-display ${accent}`}>{value}</p>
          {subtitle && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">{subtitle}</p>
          )}
        </div>
        <div
          className={`rounded-2xl p-4 ${accent.replace("text-", "bg-").replace("700", "100").replace("600", "100")} bg-opacity-20`}
        >
          <Icon className={`w-6 h-6 ${accent}`} />
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(str: string | null, len: number) {
  if (!str) return "—";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

export default function PublicationsPage() {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [stats, setStats] = useState<PubStats | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const LIMIT = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pubsData, statsData, queueData] = await Promise.allSettled([
        api.distribution.getPublications(activeFilter, LIMIT, offset),
        api.distribution.getPublicationStats(),
        api.distribution.getQueueStats(),
      ]);

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
    } catch (err) {
      console.error("Error fetching publications data:", err);
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

  const totalPages = Math.ceil(total / LIMIT);
  const currentPage = Math.floor(offset / LIMIT) + 1;

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            <BookOpen className="w-10 h-10 text-indigo-500" />
            Publications
          </h2>
          <p className="page-subtitle">
            Monitor autonomous publishing operations, retries, and distribution queue health.
          </p>
        </div>
        <PrimaryButton
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-3"
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
          />
          Sync Status
        </PrimaryButton>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <StatsCard
          title="Published"
          value={stats?.published ?? "—"}
          icon={CheckCircle2}
          accent="text-emerald-600"
          subtitle={stats ? `${stats.published_today} today` : undefined}
        />
        <StatsCard
          title="Failed"
          value={stats?.failed ?? "—"}
          icon={XCircle}
          accent="text-red-600"
          subtitle={stats ? `${stats.failed_today} today` : undefined}
        />
        <StatsCard
          title="Retrying"
          value={stats?.retrying ?? "—"}
          icon={RotateCw}
          accent="text-amber-600"
          subtitle={
            stats ? `${stats.total_retries} total retries` : undefined
          }
        />
        <StatsCard
          title="Queue Pending"
          value={queueStats?.queue?.pending ?? "—"}
          icon={Inbox}
          accent="text-blue-600"
          subtitle={
            queueStats
              ? `${queueStats.queue.delayed} delayed`
              : undefined
          }
        />
        <StatsCard
          title="Total"
          value={stats?.total ?? "—"}
          icon={TrendingUp}
          accent="text-violet-600"
          subtitle={
            stats ? `${stats.processing} processing` : undefined
          }
        />
      </div>

      {/* Filter Chips */}
      <div className="flex flex-wrap gap-3">
        {FILTER_OPTIONS.map((filter) => (
          <button
            key={filter.label}
            onClick={() => setActiveFilter(filter.value)}
            className={`px-5 py-2.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all border ${
              activeFilter === filter.value
                ? "bg-zinc-900 text-white border-zinc-900 shadow-xl shadow-zinc-900/10 dark:bg-white dark:text-zinc-900 dark:border-white"
                : "bg-white text-zinc-500 border-zinc-200 hover:border-zinc-400 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:text-white"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Publications Table */}
      <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        {loading && publications.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : publications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Inbox className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-lg font-medium">No publications found</p>
            <p className="text-sm mt-1">
              {activeFilter
                ? `No publications with status "${activeFilter}"`
                : "Publications will appear here once content is published"}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20">
                  <th className="text-left text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-8 py-5">
                    Account
                  </th>
                  <th className="text-left text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-8 py-5">
                    Content
                  </th>
                  <th className="text-left text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-8 py-5">
                    Status
                  </th>
                  <th className="text-left text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-8 py-5">
                    Retries
                  </th>
                  <th className="text-left text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-8 py-5">
                    Error Log
                  </th>
                  <th className="text-left text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest px-8 py-5 text-right">
                    Timeline
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {publications.map((pub) => (
                  <tr
                    key={pub.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group"
                  >
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-sm font-black font-display text-zinc-900 dark:text-zinc-50 tracking-tight">
                          @{pub.account_username}
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500 mt-1">
                          {pub.account_platform}
                        </span>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className="flex flex-col max-w-[200px]">
                        <span className="text-sm truncate">
                          {truncate(pub.content_caption, 60)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {pub.content_type
                            ? `${pub.content_type}${pub.content_niche ? ` · ${pub.content_niche}` : ""}`
                            : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <PublicationStatusBadge status={pub.status} />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm font-mono">
                        {pub.retry_count > 0 ? (
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">
                            {pub.retry_count}/{pub.max_retries || 3}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 max-w-[250px]">
                      {pub.error_message ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-red-600 dark:text-red-400 truncate">
                            {truncate(pub.error_message, 80)}
                          </span>
                          {pub.failure_type && (
                            <span className="text-[10px] text-muted-foreground font-mono uppercase">
                              {pub.failure_type}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-sm text-muted-foreground">
                        {formatDate(pub.published_at || pub.created_at)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 bg-muted/30">
            <span className="text-sm text-muted-foreground">
              Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of{" "}
              {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={currentPage <= 1}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                className="p-1.5 rounded-md border bg-card hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setOffset(offset + LIMIT)}
                className="p-1.5 rounded-md border bg-card hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
