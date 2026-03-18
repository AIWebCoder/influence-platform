import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/StatusBadge";
import { ProgressBar } from "@/components/ui/ProgressBar";

interface HealthBadgeProps {
  status: string;
  score: number;
}

function mapStatusToVariant(status: string): StatusBadgeVariant {
  const upper = status.toUpperCase();
  if (upper === 'ACTIVE') return "success";
  if (upper === 'WARMING') return "warning";
  if (upper === 'INACTIVE') return "neutral";
  if (upper === 'SHADOWBANNED' || upper === 'BANNED') return "danger";
  return "neutral";
}

export function HealthBadge({ status, score }: HealthBadgeProps) {
  const variant = mapStatusToVariant(status);

  return (
    <div className="flex flex-col gap-2 w-32">
      <StatusBadge variant={variant} label={status.toUpperCase()} />
      <ProgressBar value={score} max={100} />
      <span className="text-xs text-muted-foreground">{score}/100</span>
    </div>
  )
}
