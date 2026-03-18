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

interface Account {
  id: string;
  username: string;
  platform: string;
  status: string;
  health_score: number;
  proxy_url: string | null;
}

export function AccountsTable({ refreshTrigger = 0 }: { refreshTrigger?: number }) {
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
    return <div className="p-8 text-center text-muted-foreground">Loading accounts...</div>;
  }

  const formatProxy = (url: string | null) => {
    if (!url) return "Unassigned";
    try {
      return new URL(url).hostname;
    } catch {
      return url; // Fallback to raw string if not a valid URL
    }
  };

  return (
    <div className="rounded-premium border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="border-b border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/20">
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Username</TableHead>
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Platform</TableHead>
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">Infrastructure</TableHead>
            <TableHead className="px-8 py-5 text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest text-right">Health & Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map((acc) => (
            <TableRow key={acc.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group">
              <TableCell className="px-8 py-6 font-black font-display text-zinc-900 dark:text-zinc-50 tracking-tight">@{acc.username}</TableCell>
              <TableCell className="px-8 py-6">
                <span className="text-[10px] font-black uppercase tracking-widest bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 px-2.5 py-1 rounded-lg">
                  {acc.platform}
                </span>
              </TableCell>
              <TableCell className="px-8 py-6 text-zinc-400 dark:text-zinc-500 font-black text-[10px] uppercase tracking-widest">
                {formatProxy(acc.proxy_url)}
              </TableCell>
              <TableCell className="px-8 py-6 text-right">
                <HealthBadge status={acc.status} score={acc.health_score} />
              </TableCell>
            </TableRow>
          ))}
          {accounts.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="h-40 text-center text-zinc-300 dark:text-zinc-700 font-black uppercase text-[10px] tracking-widest">
                No accounts synchronized.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
