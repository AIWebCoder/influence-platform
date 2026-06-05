"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  ListOrdered,
  PlusCircle,
  RotateCw,
  XCircle,
} from "lucide-react";

import { useLocale } from "@/components/i18n/LocaleProvider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PublicationOutcome } from "@/lib/publication-outcome";

type AccountRef = { id: string; username: string };

const VARIANT_UI = {
  success: {
    icon: CheckCircle2,
    alert: "border-emerald-500/40 bg-emerald-50/80 dark:bg-emerald-950/25",
    iconClass: "text-emerald-600 dark:text-emerald-400",
    titleClass: "text-emerald-900 dark:text-emerald-100",
  },
  queued: {
    icon: Clock,
    alert: "border-sky-500/35 bg-sky-50/70 dark:bg-sky-950/20",
    iconClass: "text-sky-600 dark:text-sky-400",
    titleClass: "text-sky-900 dark:text-sky-100",
  },
  partial_failure: {
    icon: AlertTriangle,
    alert: "border-amber-500/45 bg-amber-50/80 dark:bg-amber-950/25",
    iconClass: "text-amber-600 dark:text-amber-400",
    titleClass: "text-amber-900 dark:text-amber-100",
  },
  failure: {
    icon: XCircle,
    alert: "border-destructive/50 bg-destructive/5 dark:bg-destructive/10",
    iconClass: "text-destructive",
    titleClass: "text-destructive",
  },
} as const;

function accountLabel(accountId: string, accounts: AccountRef[]): string {
  const acc = accounts.find((a) => a.id === accountId);
  return acc?.username ? `@${acc.username}` : accountId.slice(0, 8);
}

export function PublicationStatusCard({
  outcome,
  accounts,
  jobId,
  onRetry,
  onDismiss,
}: {
  outcome: PublicationOutcome;
  accounts: AccountRef[];
  jobId: string;
  onRetry: () => void;
  onDismiss?: () => void;
}) {
  const { text, t } = useLocale();
  const o = text.generationStudio.publish.outcome;
  const [techOpen, setTechOpen] = useState(false);

  const ui = VARIANT_UI[outcome.variant];
  const Icon = ui.icon;

  const title =
    outcome.variant === "success"
      ? o.successTitle
      : outcome.variant === "queued"
        ? o.queuedTitle
        : outcome.variant === "partial_failure"
          ? o.partialTitle
          : o.failureTitle;

  const body =
    outcome.variant === "success"
      ? o.successBody
      : outcome.variant === "queued"
        ? o.queuedBody
        : outcome.variant === "partial_failure"
          ? o.partialBody
          : outcome.errorMessage || o.failureBody;

  const stateLabel =
    outcome.variant === "success"
      ? o.successState
      : outcome.variant === "queued"
        ? o.queuedState
        : outcome.variant === "failure"
          ? o.failureState
          : outcome.intent.status;

  const failedTargets = outcome.intent.targets.filter((t) =>
    ["failed", "uncertain"].includes(t.status.toLowerCase())
  );

  const publicationsHref =
    outcome.variant === "failure" || outcome.variant === "partial_failure"
      ? "/publications?status=failed"
      : "/publications";
  const queueHref = "/queue";
  const studioHref = "/generation-studio";

  return (
    <Alert className={cn("relative", ui.alert)}>
      <Icon className={cn("h-5 w-5", ui.iconClass)} aria-hidden />
      <AlertTitle className={cn("text-base font-semibold", ui.titleClass)}>{title}</AlertTitle>
      <AlertDescription className="space-y-4 text-sm text-foreground/90">
        <p>{body}</p>

        <p className="text-sm">
          <span className="font-medium text-foreground">{o.stateLabel} : </span>
          <span>{stateLabel}</span>
        </p>

        {outcome.variant === "partial_failure" && failedTargets.length > 0 ? (
          <ul className="space-y-1 rounded-md border border-amber-500/30 bg-background/60 px-3 py-2 text-xs">
            {failedTargets.map((target) => (
              <li key={`${target.account_id}-${target.platform}`}>
                {accountLabel(target.account_id, accounts)} ·{" "}
                {t("generationStudio.publish.outcome.targetLine", {
                  platform: target.platform,
                  status: target.status,
                })}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" size="sm" asChild>
            <Link href={publicationsHref}>{o.viewPublications}</Link>
          </Button>
          {(outcome.variant === "success" || outcome.variant === "queued") && (
            <Button type="button" size="sm" variant="outline" asChild>
              <Link href={queueHref}>
                <ListOrdered className="mr-1.5 h-3.5 w-3.5" />
                {o.openQueue}
              </Link>
            </Button>
          )}
          {(outcome.variant === "partial_failure" || outcome.variant === "failure") && (
            <>
              <Button type="button" size="sm" variant="outline" asChild>
                <Link href={publicationsHref}>{o.viewDetails}</Link>
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                {o.retry}
              </Button>
            </>
          )}
          <Button type="button" size="sm" variant="ghost" asChild>
            <Link href={studioHref}>
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
              {o.createAnother}
            </Link>
          </Button>
          {onDismiss ? (
            <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
              {o.dismiss}
            </Button>
          ) : null}
        </div>

        <div className="border-t border-border/60 pt-3">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={techOpen}
            onClick={() => setTechOpen((v) => !v)}
          >
            {techOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {o.technicalDetails}
          </button>
          {techOpen ? (
            <dl className="mt-2 space-y-1.5 font-mono text-[11px] text-muted-foreground">
              <div className="flex gap-2">
                <dt className="shrink-0">{o.intentId}:</dt>
                <dd className="break-all">{outcome.intent.intent_id}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0">{o.rawIntentStatus}:</dt>
                <dd>{outcome.intent.status}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0">{o.action}:</dt>
                <dd>{outcome.action}</dd>
              </div>
              {outcome.dispatched ? (
                <div className="flex gap-2">
                  <dt className="shrink-0">{o.dispatchCount}:</dt>
                  <dd>{outcome.dispatchCount ?? outcome.intent.targets.length}</dd>
                </div>
              ) : null}
              {outcome.intent.targets.length > 0 ? (
                <div>
                  <dt className="mb-1">{o.targetsHeading}:</dt>
                  <dd>
                    <ul className="space-y-0.5">
                      {outcome.intent.targets.map((tgItem) => (
                        <li key={`${tgItem.account_id}-${tgItem.platform}`}>
                          {accountLabel(tgItem.account_id, accounts)} · {tgItem.platform} · {tgItem.status}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {jobId ? (
                <div className="flex gap-2">
                  <dt className="shrink-0">job:</dt>
                  <dd className="break-all">{jobId}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}
