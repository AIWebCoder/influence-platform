import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const primaryButtonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium rounded-[var(--radius-button)]",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-primary)] text-white hover:bg-[#1a1a1a] active:scale-[0.98]",
        destructive: "bg-[#E24B4A] text-white hover:bg-[#d43d3b] active:scale-[0.98]",
        ghost: "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:border-zinc-900 hover:bg-zinc-900 hover:text-white dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800",
      },
      size: {
        default: "px-6 py-3",
        sm: "px-4 py-2",
        lg: "px-8 py-4",
        icon: "p-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface PrimaryButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof primaryButtonVariants> {
  asChild?: boolean;
}

const PrimaryButton = React.forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    return (
      <button
        className={cn(primaryButtonVariants({ variant, size, className }))}
        ref={ref}
        style={{ padding: size === "default" ? "12px 24px" : undefined }}
        {...props}
      />
    );
  }
);
PrimaryButton.displayName = "PrimaryButton";

export { PrimaryButton, primaryButtonVariants };
