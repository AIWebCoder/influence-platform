"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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

interface Proxy {
  id: string;
  host: string;
  port: number;
  is_active: boolean;
  response_time: number | null;
  success_rate: string;
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
  capacity?: {
    unassigned_active: number;
    assigned?: number;
    accounts: number;
    slots_available: number;
    strict_one_to_one?: boolean;
    can_add_accounts?: boolean;
  };
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

function latencyProgressValue(ms: number) {
  return Math.min(100, (ms / 2000) * 100);
}

export default function ProxiesPage() {
  const { text } = useLocale();
  const p = text.proxies;

  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("18080");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        api.distribution.getProxies(),
        api.distribution.getProxyStats(),
      ]);
      setProxies(list);
      setStats(summary);
    } catch {
      setError(p.loadError);
    } finally {
      setLoading(false);
    }
  }, [p.loadError]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return proxies;
    return proxies.filter(
      (proxy) =>
        proxy.host.toLowerCase().includes(q) ||
        (proxy.provider?.toLowerCase().includes(q) ?? false) ||
        (proxy.country?.toLowerCase().includes(q) ?? false),
    );
  }, [proxies, search]);

  const handleAddProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHost.trim() || !newPort.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.distribution.createProxy({
        host: newHost.trim(),
        port: parseInt(newPort, 10),
        provider: "manual",
      });
      setAddOpen(false);
      setNewHost("");
      setNewPort("18080");
      await fetchData();
    } catch {
      setError(p.addError);
    } finally {
      setAdding(false);
    }
  };

  const triggerCheck = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.distribution.checkProxies();
      setTimeout(fetchData, 2000);
    } catch {
      setError(p.checkError);
    } finally {
      setRefreshing(false);
    }
  };

  const assignedCount =
    stats?.capacity?.assigned ??
    Math.max(0, (stats?.total ?? 0) - (stats?.capacity?.slots_available ?? 0));

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            {p.title}
          </h2>
          <p className="text-sm text-muted-foreground">{p.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading || refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", (loading || refreshing) && "animate-spin")} />
            {p.refresh}
          </Button>
          <Button variant="outline" onClick={triggerCheck} disabled={refreshing}>
            {p.poolHealth}
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {p.addProxy}
          </Button>
        </div>
      </div>

      {stats?.capacity?.strict_one_to_one ? (
        <Alert>
          <Activity className="h-4 w-4" />
          <AlertTitle>{p.strictPolicyTitle}</AlertTitle>
          <AlertDescription>
            {p.strictPolicyDescription.replace(
              "{slots}",
              String(stats.capacity?.slots_available ?? 0),
            )}
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{p.errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={p.activeProxies}
          value={loading ? "—" : (stats?.active ?? 0)}
          icon={CheckCircle2}
          sub={p.totalNodes.replace("{count}", String(stats?.total ?? 0))}
        />
        <StatCard
          title={p.avgLatency}
          value={loading ? "—" : stats ? `${stats.avg_latency_ms}ms` : "—"}
          icon={Zap}
          sub={p.realTimePing}
        />
        <StatCard
          title={p.unhealthy}
          value={loading ? "—" : (stats?.unhealthy ?? 0)}
          icon={XCircle}
          sub={p.requireRotation}
        />
        <StatCard
          title={p.freeSlots}
          value={loading ? "—" : (stats?.capacity?.slots_available ?? "—")}
          icon={Activity}
          sub={p.assignedSlots.replace("{count}", String(assignedCount))}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">{p.proxyNode}</CardTitle>
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder={p.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading && proxies.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{p.proxyNode}</TableHead>
                  <TableHead>{p.status}</TableHead>
                  <TableHead>{p.latency}</TableHead>
                  <TableHead>{p.successRate}</TableHead>
                  <TableHead>{p.usage}</TableHead>
                  <TableHead className="text-right">{p.lastChecked}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      {search.trim() ? p.noResults : p.empty}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((proxy) => {
                    const success = parseFloat(proxy.success_rate);
                    return (
                      <TableRow key={proxy.id}>
                        <TableCell>
                          <div className="font-medium">
                            {proxy.host}:{proxy.port}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs font-normal">
                              {proxy.provider || p.public}
                            </Badge>
                            <span className="text-xs text-muted-foreground uppercase">
                              {proxy.country || p.intl}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={proxy.is_active ? "default" : "destructive"}>
                            {proxy.is_active ? p.healthy : p.dead}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {proxy.response_time != null ? (
                            <div className="flex items-center gap-2 min-w-[120px]">
                              <Progress
                                value={latencyProgressValue(proxy.response_time)}
                                className="h-2 flex-1"
                              />
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {proxy.response_time}ms
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "text-sm font-medium",
                              success > 95
                                ? "text-emerald-600 dark:text-emerald-400"
                                : success > 80
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-destructive",
                            )}
                          >
                            {Number.isFinite(success) ? `${success.toFixed(1)}%` : "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {proxy.total_requests} {p.reqs}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground text-sm tabular-nums">
                          {proxy.last_checked_at
                            ? new Date(proxy.last_checked_at).toLocaleTimeString()
                            : p.never}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{p.addModalTitle}</DialogTitle>
            <DialogDescription>{p.addModalDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddProxy} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="proxy-host">{p.host}</Label>
              <Input
                id="proxy-host"
                value={newHost}
                onChange={(e) => setNewHost(e.target.value)}
                placeholder="proxy.example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proxy-port">{p.port}</Label>
              <Input
                id="proxy-port"
                type="number"
                min={1}
                max={65535}
                value={newPort}
                onChange={(e) => setNewPort(e.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {p.cancel}
              </Button>
              <Button type="submit" disabled={adding}>
                {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {p.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
