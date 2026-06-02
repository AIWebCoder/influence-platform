"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import toast from "react-hot-toast";
import { Plus, Trash2, KeyRound, ShieldCheck, ShieldX, Users } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api, formatContentApiError, type AppUserRole, type UserRecord } from "@/lib/api";
import { useCurrentUser } from "@/lib/auth";
import { useLocale } from "@/components/i18n/LocaleProvider";
import type { TranslationTree } from "@/lib/i18n";

function roleBadgeVariant(role: AppUserRole): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "operator") return "secondary";
  return "outline";
}

function formatDate(value: string): string {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

export default function UsersPage() {
  const { text, t } = useLocale();
  const u = text.users;
  const { isAuthenticated, isAdmin, email: currentEmail, status } = useCurrentUser();

  const swrKey = isAuthenticated && isAdmin ? "users-list" : null;
  const { data: users, error, isLoading, mutate } = useSWR<UserRecord[]>(
    swrKey,
    () => api.users.list(),
    { revalidateOnFocus: false }
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);
  const [personaTarget, setPersonaTarget] = useState<UserRecord | null>(null);

  if (status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">{u.loading}</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>{u.accessDeniedTitle}</AlertTitle>
          <AlertDescription>{u.accessDeniedDesc}</AlertDescription>
        </Alert>
      </div>
    );
  }

  async function handleToggleActive(user: UserRecord) {
    try {
      await api.users.update(user.id, { is_active: !user.is_active });
      toast.success(user.is_active ? u.deactivated : u.activated);
      mutate();
    } catch (err) {
      toast.error(formatContentApiError(err, u.updateUserError));
    }
  }

  async function handleRoleChange(user: UserRecord, role: AppUserRole) {
    if (role === user.role) return;
    try {
      await api.users.update(user.id, { role });
      toast.success(u.roleUpdated);
      mutate();
    } catch (err) {
      toast.error(formatContentApiError(err, u.updateRoleError));
    }
  }

  async function handleDelete(user: UserRecord) {
    if (!confirm(t("users.deleteConfirm", { email: user.email }))) return;
    try {
      await api.users.remove(user.id);
      toast.success(u.deleted);
      mutate();
    } catch (err) {
      toast.error(formatContentApiError(err, u.deleteError));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{u.title}</h1>
          <p className="text-sm text-muted-foreground">{u.subtitle}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" /> {u.newOperator}
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>{u.loadErrorTitle}</AlertTitle>
          <AlertDescription>{formatContentApiError(error, u.loadErrorDesc)}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{u.email}</TableHead>
              <TableHead>{u.role}</TableHead>
              <TableHead>{u.status}</TableHead>
              <TableHead>{u.createdAt}</TableHead>
              <TableHead className="text-right">{u.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {u.loadingUsers}
                </TableCell>
              </TableRow>
            ) : !users || users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  {u.empty}
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => {
                const isSelf = user.email === currentEmail;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {user.email}
                        {isSelf ? (
                          <Badge variant="outline" className="text-xs">
                            {u.youBadge}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(v) => handleRoleChange(user, v as AppUserRole)}
                        disabled={isSelf}
                      >
                        <SelectTrigger className="h-9 w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">{u.roleAdmin}</SelectItem>
                          <SelectItem value="operator">{u.roleOperator}</SelectItem>
                          <SelectItem value="viewer">{u.roleViewer}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? roleBadgeVariant(user.role) : "outline"}>
                        {user.is_active ? u.active : u.disabled}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {user.role !== "admin" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            onClick={() => setPersonaTarget(user)}
                          >
                            <Users className="size-4" />
                            {u.assignPersonas}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => setResetTarget(user)}
                        >
                          <KeyRound className="size-4" />
                          {u.reset}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={isSelf}
                          onClick={() => handleToggleActive(user)}
                          title={isSelf ? u.cannotDeactivateSelf : ""}
                        >
                          {user.is_active ? (
                            <>
                              <ShieldX className="size-4" /> {u.disable}
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="size-4" /> {u.enable}
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          disabled={isSelf}
                          onClick={() => handleDelete(user)}
                          title={isSelf ? u.cannotDeleteSelf : ""}
                        >
                          <Trash2 className="size-4" /> {u.delete}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => mutate()}
        labels={u}
      />
      <ResetPasswordDialog
        target={resetTarget}
        labels={u}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
      />
      <PersonaAssignDialog
        target={personaTarget}
        labels={u}
        onOpenChange={(open) => {
          if (!open) setPersonaTarget(null);
        }}
      />
    </div>
  );
}

function PersonaAssignDialog({
  target,
  labels: u,
  onOpenChange,
}: {
  target: UserRecord | null;
  labels: TranslationTree["users"];
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(target);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: personaData } = useSWR(
    open ? "personas-for-assign" : null,
    () => api.distribution.listPersonas(),
    { revalidateOnFocus: false },
  );
  const personas = personaData?.personas ?? [];

  useEffect(() => {
    if (!open || !target) {
      setSelected([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.users
      .getPersonas(target.id)
      .then((res) => {
        if (!cancelled) setSelected(res.persona_ids ?? []);
      })
      .catch((err) => {
        if (!cancelled) toast.error(formatContentApiError(err, u.assignPersonasError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target, u.assignPersonasError]);

  function togglePersona(id: string, checked: boolean) {
    setSelected((prev) => (checked ? [...prev, id] : prev.filter((p) => p !== id)));
  }

  async function onSave() {
    if (!target) return;
    setSubmitting(true);
    try {
      await api.users.setPersonas(target.id, selected);
      toast.success(u.assignPersonasSuccess);
      onOpenChange(false);
    } catch (err) {
      toast.error(formatContentApiError(err, u.assignPersonasError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !submitting && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{u.assignPersonasTitle}</DialogTitle>
          <DialogDescription>
            {u.assignPersonasDesc} {target ? `(${target.email})` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">{u.loadingUsers}</p>
          ) : personas.length === 0 ? (
            <p className="text-sm text-muted-foreground">{u.assignPersonasEmpty}</p>
          ) : (
            personas.map((persona) => (
              <label
                key={persona.id}
                className="flex cursor-pointer items-center gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="size-4 rounded border"
                  checked={selected.includes(persona.id)}
                  onChange={(e) => togglePersona(persona.id, e.target.checked)}
                />
                <span>{persona.name}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {u.cancel}
          </Button>
          <Button type="button" onClick={onSave} disabled={submitting || loading}>
            {submitting ? u.saving : u.assignPersonasSave}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  labels: u,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  labels: TranslationTree["users"];
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AppUserRole>("operator");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setPassword("");
      setRole("operator");
    }
  }, [open]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await api.users.create({ email: email.trim().toLowerCase(), password, role });
      toast.success(u.createSuccess);
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatContentApiError(err, u.createError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !submitting && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{u.createTitle}</DialogTitle>
          <DialogDescription>{u.createDesc}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="new-user-email">{u.email}</Label>
            <Input
              id="new-user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-password">{u.initialPassword}</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">{u.passwordRules}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-role">{u.role}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppUserRole)}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">{u.roleOperator}</SelectItem>
                <SelectItem value="viewer">{u.roleViewer}</SelectItem>
                <SelectItem value="admin">{u.roleAdmin}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              {u.cancel}
            </Button>
            <Button type="submit" disabled={submitting || !email || !password}>
              {submitting ? u.creating : u.createUser}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  target,
  onOpenChange,
  labels: u,
}: {
  target: UserRecord | null;
  onOpenChange: (open: boolean) => void;
  labels: TranslationTree["users"];
}) {
  const { t } = useLocale();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const open = target !== null;

  useEffect(() => {
    if (!open) setPassword("");
  }, [open]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!target) return;
    setSubmitting(true);
    try {
      await api.users.update(target.id, { password });
      toast.success(t("users.resetSuccess", { email: target.email }));
      onOpenChange(false);
    } catch (err) {
      toast.error(formatContentApiError(err, u.resetError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !submitting && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{u.resetTitle}</DialogTitle>
          <DialogDescription>
            {t("users.resetDesc", { email: target?.email ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reset-password">{u.newPassword}</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              {u.cancel}
            </Button>
            <Button type="submit" disabled={submitting || !password}>
              {submitting ? u.saving : u.resetPassword}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
