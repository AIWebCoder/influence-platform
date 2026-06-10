"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table";

export type EngagementIntentRow = {
  intent_id: string;
  status: string;
  action_type: string;
  target_id: string;
  error_message?: string | null;
  external_result_id?: string | null;
};

export type EngagementHistoryLabels = {
  historyType: string;
  historyTarget: string;
  historyStatus: string;
  historyResult: string;
  historyDelete: string;
  likeComment: string;
  replyAction: string;
  dmAction: string;
  statusReady: string;
  statusQueued: string;
  statusProcessing: string;
  statusCompleted: string;
  statusFailed: string;
  dash: string;
};

export type EngagementHistoryHandlers = {
  onDelete: (row: EngagementIntentRow) => void;
  deletingId?: string | null;
};

function truncate(str: string, len: number, dash: string) {
  if (!str) return dash;
  return str.length > len ? `${str.slice(0, len)}…` : str;
}

function actionLabel(actionType: string, labels: EngagementHistoryLabels): string {
  switch (actionType) {
    case "comment_like":
      return labels.likeComment;
    case "comment_reply":
      return labels.replyAction;
    case "dm_send":
      return labels.dmAction;
    default:
      return actionType;
  }
}

function statusMeta(
  status: string,
  labels: EngagementHistoryLabels,
): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  switch (status) {
    case "completed":
      return { label: labels.statusCompleted, variant: "default" };
    case "failed":
      return { label: labels.statusFailed, variant: "destructive" };
    case "processing":
      return { label: labels.statusProcessing, variant: "secondary" };
    case "queued":
      return { label: labels.statusQueued, variant: "outline" };
    case "ready":
      return { label: labels.statusReady, variant: "outline" };
    default:
      return { label: status, variant: "outline" };
  }
}

function canDeleteIntent(status: string) {
  const s = status.toLowerCase();
  return s !== "queued" && s !== "processing";
}

export function createEngagementHistoryColumns(
  labels: EngagementHistoryLabels,
  handlers?: EngagementHistoryHandlers,
): ColumnDef<EngagementIntentRow>[] {
  const columns: ColumnDef<EngagementIntentRow>[] = [
    {
      accessorKey: "action_type",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={labels.historyType} />
      ),
      cell: ({ row }) => (
        <span className="text-sm">{actionLabel(row.original.action_type, labels)}</span>
      ),
    },
    {
      accessorKey: "target_id",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={labels.historyTarget} />
      ),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {truncate(row.original.target_id, 28, labels.dash)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={labels.historyStatus} />
      ),
      cell: ({ row }) => {
        const meta = statusMeta(row.original.status, labels);
        return <Badge variant={meta.variant}>{meta.label}</Badge>;
      },
    },
    {
      id: "result",
      header: labels.historyResult,
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        const result = item.external_result_id || item.error_message;
        if (!result) {
          return <span className="text-xs text-muted-foreground">{labels.dash}</span>;
        }
        return (
          <span
            className={
              item.error_message
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
            title={result}
          >
            {truncate(result, 48, labels.dash)}
          </span>
        );
      },
    },
  ];

  if (handlers) {
    columns.push({
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const item = row.original;
        const deletable = canDeleteIntent(item.status);
        const busy = handlers.deletingId === item.intent_id;
        return (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            disabled={!deletable || busy}
            title={labels.historyDelete}
            onClick={() => handlers.onDelete(item)}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        );
      },
    });
  }

  return columns;
}
