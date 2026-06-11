"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CampaignJobRow = {
  id: string;
  status: string;
  accountLabel?: string;
};

type CampaignJobsTableLabels = {
  jobId: string;
  status: string;
  account: string;
  studio: string;
  empty: string;
};

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s === "completed") return "default";
  if (s === "failed" || s === "cancelled") return "destructive";
  if (s === "running" || s === "processing") return "secondary";
  return "outline";
}

export function CampaignJobsTable({
  jobs,
  labels,
}: {
  jobs: CampaignJobRow[];
  labels: CampaignJobsTableLabels;
}) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {labels.empty}
      </p>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{labels.jobId}</TableHead>
            <TableHead>{labels.status}</TableHead>
            <TableHead>{labels.account}</TableHead>
            <TableHead className="text-right">{labels.studio}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell className="font-mono text-xs">{job.id.slice(0, 8)}…</TableCell>
              <TableCell>
                <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {job.accountLabel || "—"}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/generation-studio?job=${encodeURIComponent(job.id)}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {labels.studio}
                  <ExternalLink className="size-3.5" />
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
