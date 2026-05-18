"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  XCircle,
  Zap,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
import {
  createProxiesColumns,
  type ProxyRow,
} from "@/components/proxies/proxies-columns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function ProxiesPage() {
  const { text } = useLocale();
  const p = text.proxies;

  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyRow | null>(null);
  const [deletingProxy, setDeletingProxy] = useState<ProxyRow | null>(null);
  const [newHost, setNewHost] = useState("");
  const [newPort, setNewPort] = useState("18080");
  const [editHost, setEditHost] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editProvider, setEditProvider] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editActive, setEditActive] = useState("true");
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        api.distribution.getProxies(),
        api.distribution.getProxyStats(),
      ]);
      setProxies(list as ProxyRow[]);
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

  const columnLabels = useMemo(
    () => ({
      proxyNode: p.proxyNode,
      status: p.status,
      latency: p.latency,
      successRate: p.successRate,
      usage: p.usage,
      lastChecked: p.lastChecked,
      actions: p.actions,
      edit: p.edit,
      delete: p.delete,
      healthy: p.healthy,
      dead: p.dead,
      never: p.never,
      reqs: p.reqs,
      public: p.public,
      intl: p.intl,
      assigned: p.assigned,
      free: p.free,
    }),
    [p],
  );

  const openEdit = useCallback((proxy: ProxyRow) => {
    setEditing(proxy);
    setEditHost(proxy.host);
    setEditPort(String(proxy.port));
    setEditProvider(proxy.provider || "");
    setEditCountry(proxy.country || "");
    setEditActive(proxy.is_active ? "true" : "false");
    setEditOpen(true);
  }, []);

  const openDelete = useCallback((proxy: ProxyRow) => {
    setDeletingProxy(proxy);
    setDeleteOpen(true);
  }, []);

  const columns = useMemo(
    () => createProxiesColumns(openEdit, openDelete, columnLabels),
    [columnLabels, openDelete, openEdit],
  );

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

  const handleEditProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      await api.distribution.updateProxy(editing.id, {
        host: editHost.trim(),
        port: parseInt(editPort, 10),
        provider: editProvider.trim() || null,
        country: editCountry.trim() || null,
        is_active: editActive === "true",
      });
      setEditOpen(false);
      setEditing(null);
      await fetchData();
    } catch {
      setError(p.updateError);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProxy = async () => {
    if (!deletingProxy) return;
    setDeleting(true);
    setError(null);
    try {
      await api.distribution.deleteProxy(deletingProxy.id);
      setDeleteOpen(false);
      setDeletingProxy(null);
      await fetchData();
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "response" in err
          ? (err as { response?: { data?: { details?: string } } }).response?.data?.details
          : null;
      setError(msg || p.deleteError);
    } finally {
      setDeleting(false);
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
        <CardHeader>
          <CardTitle className="text-base">{p.proxyNode}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && proxies.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={proxies}
              filterColumnId="host"
              filterPlaceholder={p.search}
              emptyMessage={p.empty}
            />
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

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{p.editModalTitle}</DialogTitle>
            <DialogDescription>{p.editModalDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditProxy} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-host">{p.host}</Label>
                <Input
                  id="edit-host"
                  value={editHost}
                  onChange={(e) => setEditHost(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-port">{p.port}</Label>
                <Input
                  id="edit-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={editPort}
                  onChange={(e) => setEditPort(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-provider">{p.provider}</Label>
                <Input
                  id="edit-provider"
                  value={editProvider}
                  onChange={(e) => setEditProvider(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-country">{p.country}</Label>
                <Input
                  id="edit-country"
                  value={editCountry}
                  onChange={(e) => setEditCountry(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{p.status}</Label>
              <Select value={editActive} onValueChange={setEditActive}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">{p.activeStatus}</SelectItem>
                  <SelectItem value="false">{p.inactiveStatus}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {p.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {p.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{p.deleteModalTitle}</DialogTitle>
            <DialogDescription>{p.deleteModalDescription}</DialogDescription>
          </DialogHeader>
          {deletingProxy ? (
            <p className="text-sm font-medium">
              {deletingProxy.host}:{deletingProxy.port}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              {p.cancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleDeleteProxy()}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {p.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
