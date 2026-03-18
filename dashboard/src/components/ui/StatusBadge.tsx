import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex items-center rounded-[var(--radius-badge)] px-2.5 py-0.5 text-xs font-medium transition-colors border",
  {
    variants: {
      variant: {
        success: "bg-[#EAF3DE] text-[#3B6D11] border-[#C0DD97]",
        warning: "bg-[#FAEEDA] text-[#854F0B] border-[#FAC775]",
        danger: "bg-[#FCEBEB] text-[#A32D2D] border-[#F7C1C1]",
        neutral: "bg-[#F1EFE8] text-[#5F5E5A] border-[#D3D1C7]",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export type StatusBadgeVariant = "success" | "warning" | "danger" | "neutral";

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusBadgeVariants> {
  label?: string;
}

const labelToVariantMap: Record<string, StatusBadgeVariant> = {
  ACTIVE: "success",
  WARMING: "warning",
  INACTIVE: "neutral",
  "MINIMAL RISK": "success",
  "HIGH RISK": "danger",
};

function mapLabelToVariant(label?: string): StatusBadgeVariant {
  if (!label) return "neutral";
  const upperLabel = label.toUpperCase();
  return labelToVariantMap[upperLabel] || "neutral";
}

function StatusBadge({ className, variant, label, ...props }: StatusBadgeProps) {
  const resolvedVariant = variant || mapLabelToVariant(label);
  
  return (
    <div
      className={cn(statusBadgeVariants({ variant: resolvedVariant }), className)}
      {...props}
    >
      {label}
    </div>
  );
}

export { StatusBadge, statusBadgeVariants };