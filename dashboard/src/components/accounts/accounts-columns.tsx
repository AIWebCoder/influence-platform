"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Pencil,
  Trash2,
  Twitter,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table";
import { Progress } from "@/components/ui/progress";

export type AccountRow = {
  id: string;
  username: string;
  platform: string | null;
  status: string;
  health_score: number;
  proxy_url: string | null;
  ig_user_id?: string | null;
  ig_token_configured?: boolean;
  ig_publish_ready?: boolean;
};

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

export function formatAccountProxy(url: string | null, unassigned = "Unassigned") {
  if (!url) return unassigned;
  try {
    return new URL(url.startsWith("http") ? url : `http://${url}`).hostname;
  } catch {
    return url;
  }
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const upper = status.toUpperCase();
  if (upper === "ACTIVE") return "default";
  if (upper === "WARMING") return "secondary";
  if (upper === "INACTIVE") return "outline";
  if (upper === "SHADOWBANNED" || upper === "BANNED") return "destructive";
  return "outline";
}

export type AccountsColumnLabels = {
  username: string;
  platform: string;
  proxy: string;
  igPublish: string;
  status: string;
  health: string;
  actions: string;
  edit: string;
  delete: string;
  igReady: string;
  igSetup: string;
  na: string;
  unassigned: string;
};

export function createAccountsColumns(
  onEdit: (account: AccountRow) => void,
  onDelete: (account: AccountRow) => void,
  labels: AccountsColumnLabels,
): ColumnDef<AccountRow>[] {
  return [
    {
      accessorKey: "username",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.username} />,
      cell: ({ row }) => (
        <span className="font-medium">@{row.getValue<string>("username")}</span>
      ),
    },
    {
      accessorKey: "platform",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.platform} />,
      cell: ({ row }) => {
        const platform = row.getValue<string | null>("platform");
        const Icon = getPlatformIcon(platform);
        return (
          <span className="inline-flex items-center gap-2 capitalize text-muted-foreground">
            <Icon className="h-4 w-4" />
            {(platform || "unknown").toLowerCase()}
          </span>
        );
      },
    },
    {
      id: "proxy",
      accessorFn: (row) => formatAccountProxy(row.proxy_url, labels.unassigned),
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.proxy} />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatAccountProxy(row.original.proxy_url, labels.unassigned)}
        </span>
      ),
    },
    {
      id: "ig_publish",
      header: labels.igPublish,
      enableSorting: false,
      cell: ({ row }) => {
        const acc = row.original;
        if ((acc.platform || "").toLowerCase() !== "instagram") {
          return <span className="text-xs text-muted-foreground">{labels.na}</span>;
        }
        return acc.ig_publish_ready ? (
          <Badge variant="default">{labels.igReady}</Badge>
        ) : (
          <Badge variant="outline">{labels.igSetup}</Badge>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.status} />,
      cell: ({ row }) => {
        const status = row.getValue<string>("status");
        return <Badge variant={statusBadgeVariant(status)}>{status.toUpperCase()}</Badge>;
      },
    },
    {
      accessorKey: "health_score",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.health} />,
      cell: ({ row }) => {
        const score = row.getValue<number>("health_score") || 0;
        return (
          <div className="min-w-[120px] space-y-1">
            <Progress value={score} className="h-2" />
            <p className="text-xs text-muted-foreground">{score}/100</p>
          </div>
        );
      },
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      header: () => <span className="sr-only">{labels.actions}</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="outline" size="sm" onClick={() => onEdit(row.original)}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {labels.edit}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(row.original)}
            aria-label={labels.delete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];
}
