"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Globe,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  Activity,
  BarChart3,
  Search,
  Loader2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

interface Proxy {
  id: string;
  host: string;
  port: number;
  is_active: boolean;
  response_time: number | null;
  success_rate: string; // From PG DECIMAL
  total_requests: number;
  provider: string | null;
  country: string | null;
  last_checked_at: string | null;
}

interface ProxyStats {
  total: number;
  active: number;
  unhealthy: number;
  avg_latency_ms: number;
}

function StatsCard({ title, value, icon: Icon, accent, subtitle }: any) {
  return (
    <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">{title}</p>
          <p className={cn("text-3xl font-black mt-2 font-display", accent)}>{value}</p>
          {subtitle && <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 font-medium">{subtitle}</p>}
        </div>
        <div className={cn("p-4 rounded-2xl bg-opacity-10", accent.replace("text-", "bg-"))}>
          <Icon className={cn("w-6 h-6", accent)} />
        </div>
      </div>
    </div>
  );
}

export default function ProxyDashboard() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [list, summary] = await Promise.all([
        api.distribution.getProxies(),
        api.distribution.getProxyStats()
      ]);
      setProxies(list);
      setStats(summary);
    } catch (err) {
      console.error("Failed to fetch proxy data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerCheck = async () => {
    setRefreshing(true);
    try {
      await api.distribution.checkProxies();
      // Give it a second before refreshing the list
      setTimeout(fetchData, 2000);
    } catch (err) {
      console.error("Failed to trigger check:", err);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filtered = proxies.filter(p => 
    p.host.includes(search) || 
    p.provider?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            <Globe className="w-10 h-10 text-blue-500" />
            Marketplace
          </h2>
          <p className="page-subtitle">
            Manage your rotating proxy pool, monitor latency, and track provider performance.
          </p>
        </div>
        <PrimaryButton
          onClick={triggerCheck}
          disabled={refreshing}
          className="flex items-center gap-3"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          Pool Health
        </PrimaryButton>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard 
          title="Active Proxies" 
          value={stats?.active ?? "—"} 
          icon={CheckCircle2} 
          accent="text-emerald-500" 
          subtitle={`${stats?.total ?? 0} total nodes`}
        />
        <StatsCard 
          title="Avg Latency" 
          value={stats ? `${stats.avg_latency_ms}ms` : "—"} 
          icon={Zap} 
          accent="text-amber-600" 
          subtitle="Real-time TCP ping"
        />
        <StatsCard 
          title="Unhealthy" 
          value={stats?.unhealthy ?? "—"} 
          icon={XCircle} 
          accent="text-red-600" 
          subtitle="Require rotation"
        />
        <StatsCard 
          title="Pool Capacity" 
          value={stats ? `${Math.round((stats.active / stats.total) * 100)}%` : "—"} 
          icon={Activity} 
          accent="text-blue-600" 
          subtitle="Health availability"
        />
      </div>

      {/* Main Content */}
      <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="relative w-full md:w-[400px]">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search by IP or provider..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-11 pr-4 py-3 text-sm font-bold rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500/10 placeholder:text-zinc-400 transition-all font-sans"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400 dark:text-zinc-500">Live Telemetry Active</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-950/20">
                <th className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Proxy Node</th>
                <th className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Latency</th>
                <th className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Success Rate</th>
                <th className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Usage</th>
                <th className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest text-right">Last Checked</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading proxy data...</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center text-muted-foreground">
                    <Globe className="w-12 h-12 mx-auto mb-4 opacity-10" />
                    <p>No proxies found matching your search.</p>
                  </td>
                </tr>
              ) : (
                filtered.map((proxy) => (
                  <tr key={proxy.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group">
                    <td className="px-8 py-6">
                      <div className="flex flex-col">
                        <span className="text-sm font-black font-display text-zinc-900 dark:text-zinc-50 tracking-tight">{proxy.host}:{proxy.port}</span>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2 py-0.5 rounded-lg font-black uppercase tracking-widest">{proxy.provider || "Public"}</span>
                          <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest">{proxy.country || "Intl"}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-6">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                        proxy.is_active 
                          ? "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20" 
                          : "bg-red-50 text-red-700 border-red-100 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                      )}>
                        <div className={cn("w-2 h-2 rounded-full", proxy.is_active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]")} />
                        {proxy.is_active ? "Healthy" : "Dead"}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {proxy.response_time ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 w-12 h-1 bg-muted rounded-full overflow-hidden">
                            <div 
                              className={cn(
                                "h-full", 
                                proxy.response_time < 300 ? "bg-emerald-500" : proxy.response_time < 1000 ? "bg-amber-500" : "bg-red-500"
                              )} 
                              style={{ width: `${Math.min(100, (proxy.response_time / 2000) * 100)}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono font-medium">{proxy.response_time}ms</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className={cn(
                          "text-xs font-bold",
                          parseFloat(proxy.success_rate) > 95 ? "text-emerald-600" : parseFloat(proxy.success_rate) > 80 ? "text-amber-600" : "text-red-600"
                        )}>
                          {parseFloat(proxy.success_rate).toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">{proxy.total_requests} reqs</span>
                        <div className="flex -space-x-1 mt-1">
                          {/* We could potentially list assigned avatar here later */}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {proxy.last_checked_at ? new Date(proxy.last_checked_at).toLocaleTimeString() : "Never"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
