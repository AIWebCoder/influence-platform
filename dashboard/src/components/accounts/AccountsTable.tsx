"use client";

import { useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HealthBadge } from "./HealthBadge";
import { api } from "@/lib/api";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { Instagram, Twitter, Linkedin, Facebook, Globe } from "lucide-react";

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
  linkedin: Linkedin,
  facebook: Facebook,
  default: Globe,
};

function getPlatformIcon(platform: string | undefined | null) {
  const key = (platform || "unknown").toLowerCase();
  return platformIcons[key] || platformIcons.default;
}

function getPlatformColor(platform: string | undefined | null): string {
  const key = (platform || "unknown").toLowerCase();
  if (key === "instagram" || key === "ig") return "text-pink-500 bg-pink-500/10";
  if (key === "twitter" || key === "x") return "text-sky-500 bg-sky-500/10";
  if (key === "linkedin") return "text-blue-700 bg-blue-700/10";
  if (key === "facebook") return "text-blue-600 bg-blue-600/10";
  return "text-zinc-500 bg-zinc-500/10";
}

export function AccountsTable({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
  const { text } = useLocale();
  const at = text.accountsTable;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccounts() {
      try {
        const data = await api.distribution.getAccounts();
        setAccounts(data);
      } catch (err) {
        console.error("Failed to load accounts", err);
      } finally {
        setLoading(false);
      }
    }
    loadAccounts();
  }, [refreshTrigger]);

  if (loading && accounts.length === 0) {
    return <div className="p-8 text-center text-muted-foreground">{at.loading}</div>;
  }

  const formatProxy = (url: string | null) => {
    if (!url) return at.unassigned;
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20">
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
              {at.username}
            </TableHead>
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
              {at.platform}
            </TableHead>
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
              {at.infrastructure}
            </TableHead>
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest text-right">
              {at.healthStatus}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((acc) => (
            <TableRow
              key={acc.id}
              className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group"
            >
              <TableCell className="px-8 py-6 font-black font-display text-zinc-900 dark:text-zinc-50 tracking-tight">
                @{acc.username}
              </TableCell>
              <TableCell className="px-8 py-6">
                {(() => {
                  const Icon = getPlatformIcon(acc.platform);
                  const colorClass = getPlatformColor(acc.platform);
                  return (
                    <span
                      className={`inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg ${colorClass}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {(acc.platform || at.unknown).toLowerCase()}
                    </span>
                  );
                })()}
              </TableCell>
              <TableCell className="px-8 py-6 font-mono text-xs text-zinc-500">
                {formatProxy(acc.proxy_url)}
              </TableCell>
              <TableCell className="px-8 py-6 text-right">
                <div className="flex items-center justify-end gap-4">
                  <HealthBadge status={acc.status} score={acc.health_score} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
