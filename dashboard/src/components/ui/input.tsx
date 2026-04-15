import * as React from "react"

import { cn } from "@/lib/utils"

/** Inline colors use --ip-input-* from globals.css so fields stay readable in dark mode (beats preflight `color:inherit`). */
const inputChromeStyle: React.CSSProperties = {
  backgroundColor: "var(--ip-input-bg)",
  color: "var(--ip-input-fg)",
  caretColor: "var(--ip-input-fg)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--ip-input-border)",
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, style, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "ip-input-field flex h-10 w-full rounded-[var(--radius-input)] px-3 py-2 text-sm shadow-sm outline-none transition-opacity",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "file:mr-3 file:border-0 file:bg-transparent file:px-2 file:py-1 file:text-sm file:font-medium",
          "disabled:cursor-not-allowed",
          className
        )}
        style={{ ...inputChromeStyle, ...style }}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
