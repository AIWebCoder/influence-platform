"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Users,
  Zap,
} from "lucide-react";
import { api, formatContentApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLocale } from "@/components/i18n/LocaleProvider";
import type { PersonaRow } from "@/types/persona";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ProxyOption = {
  id: string;
  host: string;
  port: number;
  is_active?: boolean;
};

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

function statusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "warming":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "suspended":
    case "banned":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatProxy(row: PersonaRow) {
  if (!row.proxy_host) return null;
  return `${row.proxy_host}:${row.proxy_port ?? "?"}`;
}

export default function PersonasPage() {
  const { text, t } = useLocale();
  const p = text.personas;

  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [proxies, setProxies] = useState<ProxyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [selected, setSelected] = useState<PersonaRow | null>(null);
  const [detailAccounts, setDetailAccounts] = useState<{ id: string; username: string }[]>([]);

  const [newName, setNewName] = useState("");
  const [newTimezone, setNewTimezone] = useState("Europe/Paris");
  const [newLocale, setNewLocale] = useState("fr-FR");
  const [saving, setSaving] = useState(false);

  const [assignProxyId, setAssignProxyId] = useState("");
  const [deviceSerial, setDeviceSerial] = useState("");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [egressById, setEgressById] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [personaRes, proxyList] = await Promise.all([
        api.distribution.listPersonas(),
        api.distribution.getProxies(),
      ]);
      setPersonas(personaRes.personas ?? []);
      setProxies(Array.isArray(proxyList) ? proxyList : []);
    } catch {
      setError(p.loadError);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [p.loadError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const stats = useMemo(() => {
    const withProxy = personas.filter((x) => x.proxy_id).length;
    const withDevice = personas.filter((x) => x.emulator_serial).length;
    const accounts = personas.reduce((n, x) => n + (x.account_count ?? 0), 0);
    return { total: personas.length, withProxy, withDevice, accounts };
  }, [personas]);

  const statusLabel = (status: string) => {
    const map: Record<string, string> = {
      active: p.active,
      warming: p.warming,
      inactive: p.inactive,
      suspended: p.suspended,
      banned: p.banned,
    };
    return map[status] ?? status;
  };

  const openManage = async (row: PersonaRow) => {
    setSelected(row);
    setAssignProxyId(row.proxy_id ?? "");
    setDeviceSerial(row.emulator_serial ?? "");
    setManageOpen(true);
    try {
      const detail = await api.distribution.getPersona(row.id);
      setDetailAccounts(
        (detail.accounts ?? []).map((a: { id: string; username: string }) => ({
          id: a.id,
          username: a.username,
        })),
      );
    } catch {
      setDetailAccounts([]);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.distribution.createPersona({
        name: newName.trim(),
        timezone: newTimezone.trim() || undefined,
        locale: newLocale.trim() || undefined,
      });
      setCreateOpen(false);
      setNewName("");
      setRefreshing(true);
      await fetchData();
    } catch {
      setError(p.createError);
    } finally {
      setSaving(false);
    }
  };

  const handleAssignProxy = async () => {
    if (!selected || !assignProxyId) return;
    setSaving(true);
    setError(null);
    try {
      await api.distribution.assignPersonaProxy(selected.id, assignProxyId);
      setRefreshing(true);
      await fetchData();
      const updated = await api.distribution.getPersona(selected.id);
      setSelected(updated);
    } catch {
      setError(p.assignProxyError);
    } finally {
      setSaving(false);
    }
  };

  const handleBindDevice = async () => {
    if (!selected || !deviceSerial.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.distribution.bindPersonaDevice(selected.id, {
        emulator_serial: deviceSerial.trim(),
      });
      setRefreshing(true);
      await fetchData();
      const updated = await api.distribution.getPersona(selected.id);
      setSelected(updated);
      setDeviceSerial(updated.emulator_serial ?? deviceSerial.trim());
    } catch {
      setError(p.bindDeviceError);
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyEgress = async (personaId: string) => {
    setVerifyingId(personaId);
    setError(null);
    try {
      const res = await api.distribution.verifyPersonaEgress(personaId);
      if (res.egress_ip) {
        setEgressById((prev) => ({ ...prev, [personaId]: res.egress_ip }));
      }
    } catch (err) {
      setError(formatContentApiError(err, p.verifyError));
    } finally {
      setVerifyingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-7 w-7 text-primary" />
            {p.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{p.subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true);
              fetchData();
            }}
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {p.refresh}
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            {p.create}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{text.proxies.errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard title={p.totalPersonas} value={stats.total} icon={ShieldCheck} />
        <StatCard title={p.withProxy} value={stats.withProxy} icon={Globe} />
        <StatCard title={p.withDevice} value={stats.withDevice} icon={Smartphone} />
        <StatCard title={p.linkedAccounts} value={stats.accounts} icon={Users} />
      </div>

      {personas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">{p.empty}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {personas.map((persona) => {
            const proxyLabel = formatProxy(persona);
            const egress = egressById[persona.id];
            return (
              <Card key={persona.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base font-medium truncate">{persona.name}</CardTitle>
                    <Badge className={cn("shrink-0", statusBadgeClass(persona.status))}>
                      {statusLabel(persona.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono truncate">{persona.id}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 flex-1">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">{p.risk}</p>
                      <p className="font-medium">{persona.risk_score ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{p.accounts}</p>
                      <p className="font-medium">{persona.account_count ?? 0}</p>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {proxyLabel ?? (
                          <span className="text-muted-foreground">{p.noProxy}</span>
                        )}
                      </span>
                      {persona.proxy_id ? (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] shrink-0",
                            persona.proxy_is_active
                              ? "border-emerald-500/50"
                              : "border-destructive/50",
                          )}
                        >
                          {persona.proxy_is_active ? p.proxyActive : p.proxyInactive}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="truncate font-mono text-xs">
                        {persona.emulator_serial ?? (
                          <span className="text-muted-foreground font-sans">{p.noDevice}</span>
                        )}
                      </span>
                    </div>
                    {egress ? (
                      <div className="flex items-center gap-2 text-xs">
                        <Zap className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {p.egressResult}: <span className="font-mono">{egress}</span>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-auto pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 min-w-[120px]"
                      disabled={!persona.proxy_id || verifyingId === persona.id}
                      onClick={() => handleVerifyEgress(persona.id)}
                    >
                      {verifyingId === persona.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Zap className="h-3.5 w-3.5 mr-1" />
                      )}
                      {p.verifyEgress}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 min-w-[100px]"
                      onClick={() => openManage(persona)}
                    >
                      {p.manage}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{p.createTitle}</DialogTitle>
            <DialogDescription>{p.createDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="persona-name">{p.name}</Label>
              <Input
                id="persona-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={p.namePlaceholder}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="persona-tz">{p.timezone}</Label>
              <Input
                id="persona-tz"
                value={newTimezone}
                onChange={(e) => setNewTimezone(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="persona-locale">{p.locale}</Label>
              <Input
                id="persona-locale"
                value={newLocale}
                onChange={(e) => setNewLocale(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {p.cancel}
            </Button>
            <Button onClick={handleCreate} disabled={saving || !newName.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {p.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageOpen}
        onOpenChange={(open) => {
          setManageOpen(open);
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{p.manageTitle}</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.name} (${selected.id})` : p.manageDescription}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="grid gap-4 py-2">
              <div className="space-y-2">
                <Label>{p.assignProxy}</Label>
                <Select value={assignProxyId} onValueChange={setAssignProxyId}>
                  <SelectTrigger>
                    <SelectValue placeholder={p.selectProxy} />
                  </SelectTrigger>
                  <SelectContent>
                    {proxies.map((px) => (
                      <SelectItem key={px.id} value={px.id}>
                        {px.host}:{px.port}
                        {!px.is_active
                          ? t("personas.inactiveSuffix", { status: p.inactive })
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={saving || !assignProxyId} onClick={handleAssignProxy}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {p.assignProxy}
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="device-serial">{p.emulatorSerial}</Label>
                <Input
                  id="device-serial"
                  value={deviceSerial}
                  onChange={(e) => setDeviceSerial(e.target.value)}
                  placeholder={p.emulatorSerialPlaceholder}
                />
                <Button
                  size="sm"
                  disabled={saving || !deviceSerial.trim()}
                  onClick={handleBindDevice}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {p.bind}
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{p.linkedAccountsList}</Label>
                {detailAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{p.noAccounts}</p>
                ) : (
                  <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
                    {detailAccounts.map((a) => (
                      <li key={a.id} className="font-mono text-xs">
                        @{a.username}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              {p.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
