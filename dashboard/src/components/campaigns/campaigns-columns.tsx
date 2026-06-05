"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from "lucide-react";

import type { CampaignRecord } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableColumnHeader } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type CampaignRow = CampaignRecord;

function jobIds(campaign: CampaignRow): string[] {
  const raw = campaign.settings?.generation_job_ids;
  return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
}

function accountCount(campaign: CampaignRow): number {
  const ids = campaign.settings?.account_ids;
  if (Array.isArray(ids) && ids.length > 0) return ids.length;
  return campaign.target_account_id ? 1 : 0;
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  const s = status.toLowerCase();
  if (s === "active") return "default";
  if (s === "paused") return "secondary";
  return "outline";
}

function typeLabel(type: string, labels: CampaignsColumnLabels): string {
  const key = type.toLowerCase();
  if (key === "content") return labels.content;
  if (key === "growth") return labels.growth;
  if (key === "engagement") return labels.engagement;
  return type;
}

export type CampaignsColumnLabels = {
  campaignName: string;
  strategyType: string;
  targeting: string;
  status: string;
  jobs: string;
  accounts: string;
  updated: string;
  actions: string;
  generate: string;
  pause: string;
  resume: string;
  studio: string;
  delete: string;
  content: string;
  growth: string;
  engagement: string;
  noTopic: string;
};

export type CampaignsColumnHandlers = {
  onGenerate: (campaign: CampaignRow) => void;
  onToggleStatus: (campaign: CampaignRow) => void;
  onDelete: (campaign: CampaignRow) => void;
  launchingId: string | null;
};

export function createCampaignsColumns(
  handlers: CampaignsColumnHandlers,
  labels: CampaignsColumnLabels,
): ColumnDef<CampaignRow>[] {
  return [
    {
      accessorKey: "name",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.campaignName} />,
      cell: ({ row }) => {
        const topic = String(row.original.settings?.topic || "").trim();
        return (
          <div className="min-w-[140px] space-y-0.5">
            <p className="font-medium leading-snug">{row.getValue<string>("name")}</p>
            {topic ? (
              <p className="line-clamp-1 text-xs text-muted-foreground">{topic}</p>
            ) : (
              <p className="text-xs italic text-muted-foreground">{labels.noTopic}</p>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "type",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.strategyType} />,
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-normal capitalize">
          {typeLabel(row.getValue<string>("type"), labels)}
        </Badge>
      ),
    },
    {
      accessorKey: "target_niche",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.targeting} />,
      cell: ({ row }) => {
        const niche = row.getValue<string | null>("target_niche");
        const jobs = jobIds(row.original).length;
        const accs = accountCount(row.original);
        return (
          <div className="text-sm">
            <span>{niche || "—"}</span>
            <p className="text-xs text-muted-foreground">
              {accs} {labels.accounts}
              {jobs > 0 ? ` · ${jobs} ${labels.jobs}` : ""}
            </p>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: ({ column }) => <DataTableColumnHeader column={column} title={labels.status} />,
      cell: ({ row }) => {
        const status = row.getValue<string>("status");
        return (
          <Badge variant={statusVariant(status)} className="capitalize">
            {status}
          </Badge>
        );
      },
    },
    {
      id: "updated_at",
      accessorFn: (row) => row.updated_at || row.created_at || "",
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={labels.updated} className="justify-end" />
      ),
      cell: ({ row }) => {
        const raw = row.original.updated_at || row.original.created_at;
        return (
          <span className="block text-right text-sm tabular-nums text-muted-foreground">
            {raw ? new Date(raw).toLocaleDateString() : "—"}
          </span>
        );
      },
    },
    {
      id: "actions",
      enableHiding: false,
      enableSorting: false,
      header: () => <span className="sr-only">{labels.actions}</span>,
      cell: ({ row }) => {
        const campaign = row.original;
        const jobs = jobIds(campaign);
        const lastJobId = jobs[jobs.length - 1];
        const isLaunching = handlers.launchingId === campaign.id;
        const isPaused = campaign.status.toLowerCase() === "paused";

        return (
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={labels.actions}>
                  {isLaunching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <MoreHorizontal className="h-4 w-4" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  disabled={isLaunching || isPaused}
                  onClick={() => handlers.onGenerate(campaign)}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {labels.generate}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handlers.onToggleStatus(campaign)}>
                  {isPaused ? (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      {labels.resume}
                    </>
                  ) : (
                    <>
                      <Pause className="mr-2 h-4 w-4" />
                      {labels.pause}
                    </>
                  )}
                </DropdownMenuItem>
                {lastJobId ? (
                  <DropdownMenuItem asChild>
                    <Link href={`/generation-studio?job=${encodeURIComponent(lastJobId)}`}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {labels.studio}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => handlers.onDelete(campaign)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {labels.delete}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];
}
