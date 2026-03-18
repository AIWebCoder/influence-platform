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

export default function AccountsPage() {
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
    setLoading(true);
    try {
      await api.distribution.addAccount({
        username,
        password_encrypted: password,
        status,
        metadata: { proxy: proxy || null }
      });
      setOpen(false);
      setUsername("");
      setPassword("");
      setStatus("warming");
      setProxy("");
      showToast("Compte ajouté avec succès!", "success");
      setRefreshTrigger(prev => prev + 1);
    } catch (err: any) {
      showToast(err.response?.data?.error || "Erreur lors de l'ajout", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 p-8 pt-6 relative">
      {/* Toast Notification */}
      {toast && (
        <div className={clsx(
          "fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium transition-all duration-300 animate-in slide-in-from-top-4",
          toast.type === "success" ? "bg-green-100 text-green-800 border border-green-200" : "bg-red-100 text-red-800 border border-red-200"
        )}>
          {toast.type === "success" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="page-title flex items-center gap-4 text-zinc-900 dark:text-zinc-50">
            Instagram Accounts
          </h2>
          <p className="page-subtitle">
            Manage and monitor your Instagram distribution nodes.
          </p>
        </div>
        
        <PrimaryButton onClick={() => setOpen(true)} className="flex items-center gap-3">
          <Plus className="w-4 h-4" />
          Add Node
        </PrimaryButton>
      </div>

      <UnifiedModal
        open={open}
        onOpenChange={setOpen}
        title="Add New Instagram Account"
        description="Enter the credentials and configuration for a new Instagram node."
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <ModalLabel>Username *</ModalLabel>
            <ModalInput
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              placeholder="e.g. my_instagram_account"
            />
          </div>
          <div className="space-y-1.5">
            <ModalLabel>Password *</ModalLabel>
            <ModalInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <ModalLabel>Status</ModalLabel>
            <ModalSelect
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="warming">Warming</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </ModalSelect>
          </div>
          <div className="space-y-1.5">
            <ModalLabel className="flex justify-between w-full">
              <span>Proxy</span>
              <span className="text-gray-400 text-xs font-normal">Optional</span>
            </ModalLabel>
            <ModalInput
              type="text"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="http://host:port"
            />
          </div>

          <ModalFooter>
            <ModalCancelButton
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </ModalCancelButton>
            <ModalPrimaryButton
              type="submit"
              disabled={loading}
              className="flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Account
            </ModalPrimaryButton>
          </ModalFooter>
        </form>
      </UnifiedModal>

      <AccountsTable refreshTrigger={refreshTrigger} />
    </div>
  );
}
