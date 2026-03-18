import * as React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrimaryButton } from "./PrimaryButton";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  cta?: {
    label: string;
    onClick: () => void;
    variant?: "default" | "destructive" | "ghost";
  };
  className?: string;
}

function EmptyState({ icon: Icon, title, subtitle, cta, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center py-8", className)}>
      {Icon && (
        <Icon className="w-6 h-6 text-zinc-400 mb-4 opacity-50" strokeWidth={1.5} />
      )}
      <h3 className="text-[15px] font-medium text-zinc-900 dark:text-zinc-50 mb-2">
        {title}
      </h3>
      {subtitle && (
        <p className="text-[13px] text-zinc-500 dark:text-zinc-400 mb-4 max-w-sm">
          {subtitle}
        </p>
      )}
      {cta && (
        <PrimaryButton
          variant={cta.variant || "default"}
          size="sm"
          onClick={cta.onClick}
        >
          {cta.label}
        </PrimaryButton>
      )}
    </div>
  );
}

export { EmptyState };