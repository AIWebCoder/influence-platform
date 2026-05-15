"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import toast from "react-hot-toast";
import { Plus, Trash2, KeyRound, ShieldCheck, ShieldX } from "lucide-react";

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
  const { isAuthenticated, isAdmin, email: currentEmail, status } = useCurrentUser();

  const swrKey = isAuthenticated && isAdmin ? "users-list" : null;
  const { data: users, error, isLoading, mutate } = useSWR<UserRecord[]>(
    swrKey,
    () => api.users.list(),
    { revalidateOnFocus: false }
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);

  if (status === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTitle>Access denied</AlertTitle>
          <AlertDescription>
            You need administrator privileges to view this page. Ask an admin to grant you access or change your role.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  async function handleToggleActive(user: UserRecord) {
    try {
      await api.users.update(user.id, { is_active: !user.is_active });
      toast.success(user.is_active ? "User deactivated." : "User activated.");
      mutate();
    } catch (err) {
      toast.error(formatContentApiError(err, "Could not update user."));
    }
  }

  async function handleRoleChange(user: UserRecord, role: AppUserRole) {
    if (role === user.role) return;
    try {
      await api.users.update(user.id, { role });
      toast.success("Role updated.");
      mutate();
    } catch (err) {
      toast.error(formatContentApiError(err, "Could not update role."));
    }
  }

  async function handleDelete(user: UserRecord) {
    if (!confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    try {
      await api.users.remove(user.id);
      toast.success("User deleted.");
      mutate();
    } catch (err) {
      toast.error(formatContentApiError(err, "Could not delete user."));
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users &amp; access</h1>
          <p className="text-sm text-muted-foreground">
            Create operator accounts, manage roles, and disable access when needed.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" /> New operator
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Failed to load users</AlertTitle>
          <AlertDescription>{formatContentApiError(error, "Try again later.")}</AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  Loading users…
                </TableCell>
              </TableRow>
            ) : !users || users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No users yet — create the first operator.
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
                            you
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
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="operator">Operator</SelectItem>
                          <SelectItem value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active ? roleBadgeVariant(user.role) : "outline"}>
                        {user.is_active ? "Active" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(user.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() => setResetTarget(user)}
                        >
                          <KeyRound className="size-4" />
                          Reset
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          disabled={isSelf}
                          onClick={() => handleToggleActive(user)}
                          title={isSelf ? "Admins cannot deactivate themselves" : ""}
                        >
                          {user.is_active ? (
                            <>
                              <ShieldX className="size-4" /> Disable
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="size-4" /> Enable
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="gap-1"
                          disabled={isSelf}
                          onClick={() => handleDelete(user)}
                          title={isSelf ? "Admins cannot delete themselves" : ""}
                        >
                          <Trash2 className="size-4" /> Delete
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
      />
      <ResetPasswordDialog
        target={resetTarget}
        onOpenChange={(open) => {
          if (!open) setResetTarget(null);
        }}
      />
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
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
      toast.success("User created.");
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error(formatContentApiError(err, "Could not create user."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !submitting && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create new user</DialogTitle>
          <DialogDescription>
            New accounts can be Operators (full operations) or Viewers (read-only). Promote to Admin only after the
            account is set up.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="new-user-email">Email</Label>
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
            <Label htmlFor="new-user-password">Initial password</Label>
            <Input
              id="new-user-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="text-xs text-muted-foreground">
              Min 8 chars, with upper, lower, digit and special character. Ask the user to change it on first login.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as AppUserRole)}>
              <SelectTrigger id="new-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="operator">Operator</SelectItem>
                <SelectItem value="viewer">Viewer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !email || !password}>
              {submitting ? "Creating…" : "Create user"}
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
}: {
  target: UserRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
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
      toast.success(`Password reset for ${target.email}.`);
      onOpenChange(false);
    } catch (err) {
      toast.error(formatContentApiError(err, "Could not reset password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !submitting && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Issue a new password for <span className="font-medium">{target?.email}</span>. Share it securely; they
            should change it on first sign-in.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="reset-password">New password</Label>
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
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !password}>
              {submitting ? "Saving…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
