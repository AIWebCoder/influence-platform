"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Loader2,
  Plus,
  RefreshCw,
  Twitter,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
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

interface Account {
  id: string;
  username: string;
  platform: string | null;
  status: string;
  health_score: number;
  proxy_url: string | null;
}

const platformIcons: Record<string, React.ElementType> = {
  instagram: Instagram,
  twitter: Twitter,
  x: Twitter,
  tiktok: Globe,
  facebook: Facebook,
  linkedin: Linkedin,
  default: Globe,
};

function getPlatformIcon(platform: string | undefined | null) {
  const key = (platform || "unknown").toLowerCase();
  return platformIcons[key] || platformIcons.default;
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const upper = status.toUpperCase();
  if (upper === "ACTIVE") return "default";
  if (upper === "WARMING") return "secondary";
  if (upper === "INACTIVE") return "outline";
  if (upper === "SHADOWBANNED" || upper === "BANNED") return "destructive";
  return "outline";
}

function formatProxy(url: string | null) {
  if (!url) return "Unassigned";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
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

export default function AccountsPage() {
  const { text } = useLocale();

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("warming");
  const [platform, setPlatform] = useState("instagram");
  const [proxy, setProxy] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.distribution.getAccounts();
      setAccounts(data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load accounts.");
    } finally {
      setLoading(false);
    }
  }, []);

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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    const trimmedProxy = proxy.trim();

    if (!trimmedUsername) {
      setError("Username is required.");
      return;
    }
    if (trimmedPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.distribution.addAccount({
        username: trimmedUsername,
        password_encrypted: trimmedPassword,
        status,
        platform,
        metadata: { proxy: trimmedProxy || null },
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

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            {text.accounts.title}
          </h2>
          <p className="text-sm text-muted-foreground">{text.accounts.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadAccounts} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {text.accounts.addNode}
          </Button>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total" value={stats.total} icon={Users} />
        <StatCard title="Active" value={stats.active} icon={CheckCircle2} />
        <StatCard title="Warming" value={stats.warming} icon={RefreshCw} />
        <StatCard title="Inactive" value={stats.inactive} icon={AlertCircle} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && accounts.length === 0 ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Proxy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[180px]">Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((acc) => {
                  const Icon = getPlatformIcon(acc.platform);
                  return (
                    <TableRow key={acc.id}>
                      <TableCell className="font-medium">@{acc.username}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" />
                          {(acc.platform || "unknown").toLowerCase()}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatProxy(acc.proxy_url)}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(acc.status)}>{acc.status.toUpperCase()}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Progress value={acc.health_score || 0} className="h-2" />
                          <p className="text-xs text-muted-foreground">{acc.health_score || 0}/100</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {accounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      No accounts synchronized.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
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
    </div>
  );
}
