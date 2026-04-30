"use client";

import { useState } from "react";
import { AccountsTable } from "@/components/accounts/AccountsTable";
import { Plus, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import {
  UnifiedModal,
  ModalInput,
  ModalSelect,
  ModalLabel,
  ModalFooter,
  ModalPrimaryButton,
  ModalCancelButton,
} from "@/components/ui/UnifiedModal";
import { api } from "@/lib/api";
import clsx from "clsx";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { useLocale } from "@/components/i18n/LocaleProvider";

export default function AccountsPage() {
  const { text } = useLocale();
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("warming");
  const [proxy, setProxy] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    const trimmedProxy = proxy.trim();
    if (!trimmedUsername) {
      showToast("Username is required.", "error");
      return;
    }
    if (trimmedPassword.length < 8) {
      showToast("Password must be at least 8 characters.", "error");
      return;
    }
    setLoading(true);
    try {
      await api.distribution.addAccount({
        username: trimmedUsername,
        password_encrypted: trimmedPassword,
        status,
        metadata: { proxy: trimmedProxy || null },
      });
      setOpen(false);
      setUsername("");
      setPassword("");
      setStatus("warming");
      setProxy("");
      showToast(text.accounts.success, "success");
      setRefreshTrigger((prev) => prev + 1);
    } catch (err: any) {
      const serverMessage =
        err?.response?.data?.detail ||
        err?.response?.data?.error ||
        err?.message;
      showToast(serverMessage || text.accounts.error, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6 relative">
      {toast && (
        <div
          className={clsx(
            "fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all duration-300 animate-in slide-in-from-top-4",
            toast.type === "success" ? "bg-green-100 text-green-800 border border-green-200" : "bg-red-100 text-red-800 border border-red-200"
          )}
        >
          {toast.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">{text.accounts.title}</h2>
          <p className="page-subtitle">{text.accounts.subtitle}</p>
        </div>

        <PrimaryButton onClick={() => setOpen(true)} className="flex items-center gap-3">
          <Plus className="w-4 h-4" />
          {text.accounts.addNode}
        </PrimaryButton>
      </div>

      <UnifiedModal
        open={open}
        onOpenChange={setOpen}
        title={text.accounts.modalTitle}
        description={text.accounts.modalDescription}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <ModalLabel>{text.accounts.username} *</ModalLabel>
            <ModalInput
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder={text.accounts.usernamePlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <ModalLabel>{text.accounts.password} *</ModalLabel>
            <ModalInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <ModalLabel>{text.accounts.status}</ModalLabel>
            <ModalSelect value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="warming">{text.accounts.warming}</option>
              <option value="active">{text.accounts.active}</option>
              <option value="inactive">{text.accounts.inactive}</option>
            </ModalSelect>
          </div>
          <div className="space-y-1.5">
            <ModalLabel className="flex justify-between w-full">
              <span>{text.accounts.proxy}</span>
              <span className="text-gray-400 text-xs font-normal">{text.accounts.optional}</span>
            </ModalLabel>
            <ModalInput
              type="text"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder={text.accounts.proxyPlaceholder}
            />
          </div>

          <ModalFooter>
            <ModalCancelButton type="button" onClick={() => setOpen(false)}>
              {text.accounts.cancel}
            </ModalCancelButton>
            <ModalPrimaryButton type="submit" disabled={loading} className="flex items-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {text.accounts.save}
            </ModalPrimaryButton>
          </ModalFooter>
        </form>
      </UnifiedModal>

      <AccountsTable refreshTrigger={refreshTrigger} />
    </div>
  );
}
