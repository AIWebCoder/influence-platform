"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import toast from "react-hot-toast";
import { api, formatContentApiError } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import {
  createAccountsColumns,
  formatAccountProxy,
  type AccountRow,
} from "@/components/accounts/accounts-columns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ProxyRow = {
  id: string;
  host: string;
  port: number;
  is_active: boolean;
  assigned_account_id?: string | null;
};

type BulkAccountRow = {
  username: string;
  password_encrypted: string;
  status?: string;
  ig_user_id?: string;
  ig_access_token?: string;
};

function parseBulkAccountLines(raw: string): BulkAccountRow[] {
  const rows: BulkAccountRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(",").map((p) => p.trim());
    const [username, password, status, igUserId, igToken] = parts;
    if (!username || !password) continue;
    rows.push({
      username,
      password_encrypted: password,
      ...(status ? { status: status.toLowerCase() } : {}),
      ...(igUserId ? { ig_user_id: igUserId } : {}),
      ...(igToken ? { ig_access_token: igToken } : {}),
    });
  }
  return rows;
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

export default function AccountsPage() {
  const { text, t } = useLocale();
  const a = text.accounts;

  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    created: number;
    failed: number;
    failures: Array<{ username: string; error: string }>;
  } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("warming");
  const [platform, setPlatform] = useState("instagram");
  const [proxy, setProxy] = useState("");
  const [igUserId, setIgUserId] = useState("");
  const [igAccessToken, setIgAccessToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState<AccountRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null);
  const [editStatus, setEditStatus] = useState("warming");
  const [editIgUserId, setEditIgUserId] = useState("");
  const [editIgAccessToken, setEditIgAccessToken] = useState("");
  const [editProxyId, setEditProxyId] = useState("");
  const [availableProxies, setAvailableProxies] = useState<ProxyRow[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [proxyAssigning, setProxyAssigning] = useState(false);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [proxySlots, setProxySlots] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, proxyStats] = await Promise.all([
        api.distribution.getAccounts(),
        api.distribution.getProxyStats().catch(() => null),
      ]);
      setAccounts(data);
      setProxySlots(proxyStats?.capacity?.slots_available ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.error || a.loadError);
    } finally {
      setLoading(false);
    }
  }, [a.loadError]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const stats = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter((a) => a.status?.toUpperCase() === "ACTIVE").length;
    const warming = accounts.filter((a) => a.status?.toUpperCase() === "WARMING").length;
    const inactive = accounts.filter((a) => a.status?.toUpperCase() === "INACTIVE").length;
    return { total, active, warming, inactive };
  }, [accounts]);

  const resetForm = () => {
    setUsername("");
    setPassword("");
    setStatus("warming");
    setPlatform("instagram");
    setProxy("");
    setIgUserId("");
    setIgAccessToken("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    const trimmedProxy = proxy.trim();

    if (!trimmedUsername) {
      setError(a.usernameRequired);
      return;
    }
    if (trimmedPassword.length < 8) {
      setError(a.passwordMin);
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const isInstagram = platform.toLowerCase() === "instagram";
      await api.distribution.addAccount({
        username: trimmedUsername,
        password_encrypted: trimmedPassword,
        status,
        platform,
        metadata: { proxy: trimmedProxy || null },
        ...(isInstagram && igUserId.trim()
          ? { ig_user_id: igUserId.trim() }
          : {}),
        ...(isInstagram && igAccessToken.trim()
          ? { ig_access_token: igAccessToken.trim() }
          : {}),
      });
      setSuccess(text.accounts.success);
      setOpen(false);
      resetForm();
      await loadAccounts();
    } catch (err: any) {
      const serverMessage =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message;
      setError(serverMessage || text.accounts.error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseBulkAccountLines(bulkText);
    if (parsed.length === 0) {
      setError(text.accounts.bulkParseError);
      return;
    }
    const invalid = parsed.find((r) => r.password_encrypted.length < 8);
    if (invalid) {
      setError(`Password for @${invalid.username} must be at least 8 characters.`);
      return;
    }

    setBulkSubmitting(true);
    setError(null);
    setSuccess(null);
    setBulkResult(null);
    try {
      const result = await api.distribution.bulkImportAccounts(parsed);
      setBulkResult({
        created: result.created_count,
        failed: result.failed_count,
        failures: result.failed.map((f) => ({
          username: f.username || `row ${f.index + 1}`,
          error: f.error,
        })),
      });
      setSuccess(
        text.accounts.bulkSuccess
          .replace("{created}", String(result.created_count))
          .replace("{failed}", String(result.failed_count)),
      );
      if (result.created_count > 0) {
        await loadAccounts();
      }
      if (result.failed_count === 0) {
        setBulkText("");
        setBulkOpen(false);
      }
    } catch (err: unknown) {
      const serverMessage =
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { data?: { error?: string; detail?: string } } }).response?.data
          ? (err as { response: { data: { error?: string; detail?: string } } }).response.data.error ||
            (err as { response: { data: { detail?: string } } }).response.data.detail
          : err instanceof Error
            ? err.message
            : null;
      setError(serverMessage || text.accounts.bulkError);
    } finally {
      setBulkSubmitting(false);
    }
  };

  const openDelete = useCallback((acc: AccountRow) => {
    setDeletingAccount(acc);
    setDeleteOpen(true);
  }, []);

  const handleDeleteAccount = async () => {
    if (!deletingAccount) return;
    setDeleting(true);
    setError(null);
    try {
      await api.distribution.deleteAccount(deletingAccount.id);
      toast.success(a.deleted);
      setDeleteOpen(false);
      if (editAccount?.id === deletingAccount.id) {
        setEditOpen(false);
        setEditAccount(null);
      }
      setDeletingAccount(null);
      await loadAccounts();
    } catch (err: unknown) {
      const msg = formatContentApiError(err, a.deleteError);
      setError(msg);
      toast.error(msg);
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = useCallback(async (acc: AccountRow) => {
    setEditAccount(acc);
    setEditStatus((acc.status || "warming").toLowerCase());
    setEditIgUserId(acc.ig_user_id || "");
    setEditIgAccessToken("");
    setEditProxyId("");
    setEditOpen(true);
    try {
      const proxies = (await api.distribution.getProxies()) as ProxyRow[];
      setAvailableProxies(
        proxies.filter(
          (p) => p.is_active && (!p.assigned_account_id || p.assigned_account_id === acc.id),
        ),
      );
    } catch {
      setAvailableProxies([]);
    }
  }, []);

  const columnLabels = useMemo(
    () => ({
      username: a.username,
      platform: a.platform,
      proxy: a.proxy,
      igPublish: a.igPublish,
      status: a.status,
      health: a.health,
      actions: a.actions,
      edit: a.editAccount,
      delete: a.delete,
      igReady: a.igReady,
      igSetup: a.igSetup,
      na: a.na,
      unassigned: a.unassigned,
    }),
    [a],
  );

  const columns = useMemo(
    () => createAccountsColumns(openEdit, openDelete, columnLabels),
    [openEdit, openDelete, columnLabels],
  );

  const handleSaveEdit = async () => {
    if (!editAccount) return;
    setEditSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (editStatus !== (editAccount.status || "").toLowerCase()) {
        await api.distribution.updateAccountStatus(editAccount.id, editStatus);
      }
      if (editIgUserId.trim() || editIgAccessToken.trim()) {
        await api.distribution.updateAccountInstagram(editAccount.id, {
          ...(editIgUserId.trim() ? { ig_user_id: editIgUserId.trim() } : {}),
          ...(editIgAccessToken.trim() ? { ig_access_token: editIgAccessToken.trim() } : {}),
        });
      }
      setSuccess(text.accounts.success);
      setEditOpen(false);
      await loadAccounts();
    } catch (err: unknown) {
      setError(formatContentApiError(err, text.accounts.error));
    } finally {
      setEditSaving(false);
    }
  };

  const handleAssignProxy = async (proxyId?: string) => {
    if (!editAccount) return;
    setProxyAssigning(true);
    setError(null);
    try {
      await api.distribution.assignAccountProxy(editAccount.id, proxyId);
      setSuccess(text.accounts.assignProxySuccess);
      await loadAccounts();
      const refreshed = (await api.distribution.getAccounts()) as AccountRow[];
      const updated = refreshed.find((a) => a.id === editAccount.id);
      if (updated) {
        setEditAccount(updated);
        const proxies = (await api.distribution.getProxies()) as ProxyRow[];
        setAvailableProxies(
          proxies.filter(
            (p) => p.is_active && (!p.assigned_account_id || p.assigned_account_id === updated.id),
          ),
        );
      }
    } catch (err: unknown) {
      setError(formatContentApiError(err, text.accounts.assignProxyError));
    } finally {
      setProxyAssigning(false);
    }
  };

  const handleRotateProxy = async () => {
    if (!editAccount) return;
    setProxyAssigning(true);
    setError(null);
    try {
      await api.distribution.rotateAccountProxy(editAccount.id);
      setSuccess(text.accounts.assignProxySuccess);
      await loadAccounts();
    } catch (err: unknown) {
      setError(formatContentApiError(err, text.accounts.assignProxyError));
    } finally {
      setProxyAssigning(false);
    }
  };

  const hasAssignedProxy = Boolean(
    editAccount?.proxy_url && formatAccountProxy(editAccount.proxy_url, a.unassigned) !== a.unassigned,
  );

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            {a.title}
          </h2>
          <p className="text-sm text-muted-foreground">{a.subtitle}</p>
        </div>
        <div className="flex h-10 gap-2">
          <Button
            variant="outline"
            className="h-full min-h-0 shrink-0"
            onClick={loadAccounts}
            disabled={loading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {a.refresh}
          </Button>
          <Button variant="outline" className="h-full min-h-0 shrink-0" onClick={() => setBulkOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            {a.bulkImport}
          </Button>
          <Button className="h-full min-h-0 shrink-0" onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {a.addNode}
          </Button>
        </div>
      </div>

      {proxySlots !== null && proxySlots < 3 ? (
        <Alert variant={proxySlots === 0 ? "destructive" : "default"}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{a.proxyPoolTitle}</AlertTitle>
          <AlertDescription>
            {proxySlots === 0
              ? a.proxyPoolEmpty
              : t("accounts.proxyPoolSlots", { count: proxySlots })}{" "}
            <a href="/proxies" className="font-medium underline">
              {a.manageProxies}
            </a>
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{a.errorTitle}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>{a.successTitle}</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title={a.statTotal} value={stats.total} icon={Users} />
        <StatCard title={a.active} value={stats.active} icon={CheckCircle2} />
        <StatCard title={a.warming} value={stats.warming} icon={RefreshCw} />
        <StatCard title={a.inactive} value={stats.inactive} icon={AlertCircle} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{a.listTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && accounts.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={accounts}
              filterColumnId="username"
              filterPlaceholder={text.accountHealth.search}
              emptyMessage={a.emptyList}
              paginationLabels={text.dataTable}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{text.accounts.modalTitle}</DialogTitle>
            <DialogDescription>{text.accounts.modalDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{text.accounts.username} *</Label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={text.accounts.usernamePlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{text.accounts.password} *</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>{text.accounts.platform}</Label>
              <Select value={platform} onValueChange={setPlatform}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram">{text.accounts.platformInstagram}</SelectItem>
                  <SelectItem value="tiktok" disabled>
                    {text.accounts.platformTiktok}
                  </SelectItem>
                  <SelectItem value="facebook" disabled>
                    {text.accounts.platformFacebook}
                  </SelectItem>
                  <SelectItem value="twitter" disabled>
                    {text.accounts.platformTwitter}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{text.accounts.status}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="warming">{text.accounts.warming}</SelectItem>
                  <SelectItem value="active">{text.accounts.active}</SelectItem>
                  <SelectItem value="inactive">{text.accounts.inactive}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex justify-between">
                <span>{text.accounts.proxy}</span>
                <span className="text-muted-foreground text-xs font-normal">{text.accounts.optional}</span>
              </Label>
              <Input
                type="text"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
                placeholder={text.accounts.proxyPlaceholder}
              />
            </div>
            {platform.toLowerCase() === "instagram" ? (
              <>
                <div className="space-y-1.5">
                  <Label>{a.igUserIdLabel}</Label>
                  <Input
                    type="text"
                    value={igUserId}
                    onChange={(e) => setIgUserId(e.target.value)}
                    placeholder={a.igUserIdPlaceholder}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{a.igAccessTokenLabel}</Label>
                  <Input
                    type="password"
                    value={igAccessToken}
                    onChange={(e) => setIgAccessToken(e.target.value)}
                    placeholder={a.tokenPlaceholder}
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">{a.igTokenHint}</p>
                </div>
              </>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {text.accounts.cancel}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {text.accounts.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkOpen}
        onOpenChange={(next) => {
          setBulkOpen(next);
          if (!next) {
            setBulkResult(null);
            setBulkText("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{text.accounts.bulkModalTitle}</DialogTitle>
            <DialogDescription>{text.accounts.bulkModalDescription}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleBulkSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>{text.accounts.bulkImport}</Label>
              <textarea
                className="flex min-h-[160px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={text.accounts.bulkPlaceholder}
                spellCheck={false}
              />
            </div>
            {bulkResult && bulkResult.failures.length > 0 ? (
              <Alert variant="destructive">
                <AlertTitle>
                  {bulkResult.failed}{" "}
                  {bulkResult.failed === 1 ? a.bulkFailure : a.bulkFailures}
                </AlertTitle>
                <AlertDescription>
                  <ul className="mt-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-4 text-xs">
                    {bulkResult.failures.map((f) => (
                      <li key={`${f.username}-${f.error}`}>
                        @{f.username}: {f.error}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBulkOpen(false)}>
                {text.accounts.cancel}
              </Button>
              <Button type="submit" disabled={bulkSubmitting}>
                {bulkSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {text.accounts.bulkSubmit}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{text.accounts.editModalTitle}</DialogTitle>
            <DialogDescription>
              {editAccount ? `@${editAccount.username}` : text.accounts.editModalDescription}
            </DialogDescription>
          </DialogHeader>
          {editAccount ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{text.accounts.status}</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warming">{text.accounts.warming}</SelectItem>
                    <SelectItem value="active">{text.accounts.active}</SelectItem>
                    <SelectItem value="inactive">{text.accounts.inactive}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">{text.accounts.currentProxy}</p>
                <p className="text-sm text-muted-foreground">
                  {hasAssignedProxy
                    ? formatAccountProxy(editAccount.proxy_url, a.unassigned)
                    : a.unassigned}
                </p>
                {availableProxies.length === 0 && !hasAssignedProxy ? (
                  <p className="text-xs text-muted-foreground">{text.accounts.noFreeProxiesHint}</p>
                ) : null}
                {!hasAssignedProxy && availableProxies.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label>{text.accounts.pickProxy}</Label>
                    <Select value={editProxyId || "__auto__"} onValueChange={(v) => setEditProxyId(v === "__auto__" ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__auto__">{text.accounts.autoAssignProxy}</SelectItem>
                        {availableProxies.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.host}:{p.port}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  {!hasAssignedProxy ? (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      disabled={proxyAssigning || (availableProxies.length === 0 && !editProxyId)}
                      onClick={() => handleAssignProxy(editProxyId || undefined)}
                    >
                      {proxyAssigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {text.accounts.assignProxy}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={proxyAssigning || availableProxies.length === 0}
                      onClick={handleRotateProxy}
                    >
                      {proxyAssigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      {text.accounts.rotateProxy}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{a.igUserIdLabel}</Label>
                <Input
                  value={editIgUserId}
                  onChange={(e) => setEditIgUserId(e.target.value)}
                  placeholder={a.igUserIdPlaceholder}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{a.igAccessTokenLabel}</Label>
                <Input
                  type="password"
                  value={editIgAccessToken}
                  onChange={(e) => setEditIgAccessToken(e.target.value)}
                  placeholder={
                    editAccount.ig_token_configured ? a.keepTokenPlaceholder : a.tokenPlaceholder
                  }
                  autoComplete="off"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              disabled={!editAccount || deleting}
              onClick={() => editAccount && openDelete(editAccount)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {a.delete}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {text.accounts.cancel}
              </Button>
              <Button type="button" onClick={handleSaveEdit} disabled={editSaving}>
                {editSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {text.accounts.saveChanges}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeletingAccount(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{a.deleteTitle}</DialogTitle>
            <DialogDescription>
              {deletingAccount
                ? t("accounts.deleteDescription", { username: `@${deletingAccount.username}` })
                : a.deleteDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {a.cancel}
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={() => void handleDeleteAccount()}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {a.deleteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
