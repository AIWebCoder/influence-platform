"use client";

import Link from "next/link";
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

type EmulatorOption = {
  serial: string;
  status: string;
  model?: string | null;
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

function ManageSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-muted/20 p-4 shadow-sm">
      <div className="mb-4 flex gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-sm font-semibold leading-none">{title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function PersonasPage() {
  const { text } = useLocale();
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
  const [emulators, setEmulators] = useState<EmulatorOption[]>([]);
  const [emulatorsLoading, setEmulatorsLoading] = useState(false);
  const [emulatorsError, setEmulatorsError] = useState<string | null>(null);
  const [manualSerial, setManualSerial] = useState(false);
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

  const loadEmulators = useCallback(async () => {
    setEmulatorsLoading(true);
    setEmulatorsError(null);
    try {
      const res = await fetch("/api/emulators", { cache: "no-store" });
      const payload = (await res.json()) as {
        items?: EmulatorOption[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error || `HTTP ${res.status}`);
      }
      setEmulators(Array.isArray(payload.items) ? payload.items : []);
      if (payload.error) {
        setEmulatorsError(payload.error);
      }
    } catch (err) {
      setEmulators([]);
      setEmulatorsError(
        err instanceof Error ? err.message : "Unable to fetch emulator list",
      );
    } finally {
      setEmulatorsLoading(false);
    }
  }, []);

  const emulatorChoices = useMemo(() => {
    const bySerial = new Map<string, EmulatorOption>();
    for (const item of emulators) {
      if (item.serial) {
        bySerial.set(item.serial, item);
      }
    }
    if (deviceSerial && !bySerial.has(deviceSerial)) {
      bySerial.set(deviceSerial, { serial: deviceSerial, status: "bound" });
    }
    return Array.from(bySerial.values()).sort((a, b) =>
      a.serial.localeCompare(b.serial),
    );
  }, [emulators, deviceSerial]);

  const openManage = async (row: PersonaRow) => {
    setSelected(row);
    setAssignProxyId(row.proxy_id ?? "");
    setDeviceSerial(row.emulator_serial ?? "");
    setManualSerial(false);
    setManageOpen(true);
    void loadEmulators();
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
                placeholder="persona-paris-1"
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
        <DialogContent className="flex max-h-[min(90vh,40rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="space-y-3 border-b border-border/60 bg-muted/30 px-6 py-5">
            <DialogTitle className="text-lg">{p.manageTitle}</DialogTitle>
            {selected ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{selected.name}</span>
                  <Badge className={cn("text-[10px] font-medium", statusBadgeClass(selected.status))}>
                    {statusLabel(selected.status)}
                  </Badge>
                </div>
                <p className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {selected.id}
                </p>
              </div>
            ) : (
              <DialogDescription>{p.manageDescription}</DialogDescription>
            )}
          </DialogHeader>

          {selected ? (
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              <ManageSection icon={Globe} title={p.assignProxy} description={p.manageProxyHint}>
                <div className="space-y-3">
                  <Select value={assignProxyId} onValueChange={setAssignProxyId}>
                    <SelectTrigger className="h-10 bg-background">
                      <SelectValue placeholder={p.selectProxy} />
                    </SelectTrigger>
                    <SelectContent>
                      {proxies.map((px) => (
                        <SelectItem key={px.id} value={px.id}>
                          <span className="flex items-center gap-2">
                            <span>
                              {px.host}:{px.port}
                            </span>
                            {!px.is_active ? (
                              <span className="text-xs text-amber-600 dark:text-amber-400">
                                ({p.proxyInactive})
                              </span>
                            ) : null}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {assignProxyId &&
                  proxies.find((px) => px.id === assignProxyId)?.is_active === false ? (
                    <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                      {p.proxyInactive}
                    </p>
                  ) : null}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-w-[7.5rem]"
                      disabled={saving || !assignProxyId}
                      onClick={handleAssignProxy}
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {p.assignProxy}
                    </Button>
                  </div>
                </div>
              </ManageSection>

              <ManageSection icon={Smartphone} title={p.bindDevice} description={p.manageDeviceHint}>
                <div className="space-y-3">
                  {emulatorsLoading ? (
                    <Skeleton className="h-10 w-full rounded-md" />
                  ) : emulatorChoices.length > 0 && !manualSerial ? (
                    <Select value={deviceSerial} onValueChange={setDeviceSerial}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder={p.selectEmulator} />
                      </SelectTrigger>
                      <SelectContent>
                        {emulatorChoices.map((em) => (
                          <SelectItem key={em.serial} value={em.serial}>
                            <span className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                              <span className="font-mono text-xs">{em.serial}</span>
                              {em.model ? (
                                <span className="text-xs text-muted-foreground">{em.model}</span>
                              ) : null}
                              {em.status !== "device" ? (
                                <span className="text-xs text-amber-600 dark:text-amber-400">
                                  ({em.status})
                                </span>
                              ) : null}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="space-y-3 rounded-lg border border-dashed border-border/80 bg-background/50 p-3">
                      {emulatorChoices.length === 0 ? (
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {emulatorsError ?? p.noEmulators}{" "}
                          <Link
                            href="/emulators"
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {p.openEmulators}
                          </Link>
                        </p>
                      ) : null}
                      <div className="space-y-2">
                        <Label htmlFor="device-serial" className="text-xs text-muted-foreground">
                          {p.emulatorManualSerial}
                        </Label>
                        <Input
                          id="device-serial"
                          className="h-10 bg-background font-mono text-sm"
                          value={deviceSerial}
                          onChange={(e) => setDeviceSerial(e.target.value)}
                          placeholder="emulator-5554"
                        />
                      </div>
                    </div>
                  )}
                  {emulatorChoices.length > 0 ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                      onClick={() => setManualSerial((v) => !v)}
                    >
                      {manualSerial ? p.selectEmulator : p.emulatorManualSerial}
                    </button>
                  ) : null}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="min-w-[7.5rem]"
                      disabled={saving || !deviceSerial.trim()}
                      onClick={handleBindDevice}
                    >
                      {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {p.bind}
                    </Button>
                  </div>
                </div>
              </ManageSection>

              <ManageSection
                icon={Users}
                title={p.linkedAccountsList}
                description={p.manageAccountsHint}
              >
                {detailAccounts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{p.noAccounts}</p>
                ) : (
                  <ul className="max-h-36 space-y-2 overflow-y-auto">
                    {detailAccounts.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/60 px-3 py-2"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
                          {a.username.slice(0, 1)}
                        </span>
                        <span className="min-w-0 truncate font-mono text-sm">@{a.username}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </ManageSection>
            </div>
          ) : null}

          <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-4 sm:justify-end">
            <Button variant="outline" onClick={() => setManageOpen(false)}>
              {p.cancel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
